/*
 * Copyright 2021 Concurrent Technologies Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.ctc.omega_edit.grpc

import org.apache.pekko.NotUsed
import org.apache.pekko.actor.{ActorSystem, Cancellable}
import org.apache.pekko.grpc.GrpcServiceException
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.pattern.ask
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.Timeout
import com.ctc.omega_edit.api
import com.ctc.omega_edit.api.{OmegaEdit, Version}
import com.ctc.omega_edit.grpc.EditorService._
import com.ctc.omega_edit.grpc.Editors._
import com.ctc.omega_edit.grpc.Session._
import com.google.protobuf.ByteString
import com.google.protobuf.empty.Empty
import io.grpc.Status
import omega_edit._

import java.lang.management.ManagementFactory
import java.net.SocketAddress
import java.nio.file.Paths
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.{AtomicBoolean, AtomicLong}
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.{Failure, Success}

import scala.jdk.CollectionConverters._

class EditorService(implicit val system: ActorSystem) extends Editor {
  private implicit val timeout: Timeout = Timeout(20.seconds)
  private implicit val ec: ExecutionContext = system.dispatcher

  private val config = system.settings.config

  private val sessionTimeoutMillis: Long =
    if (config.hasPath("omega-edit.grpc.heartbeat.session-timeout")) {
      config.getDuration("omega-edit.grpc.heartbeat.session-timeout").toMillis
    } else {
      0L
    }

  private val cleanupIntervalMillis: Long =
    if (config.hasPath("omega-edit.grpc.heartbeat.cleanup-interval")) {
      config.getDuration("omega-edit.grpc.heartbeat.cleanup-interval").toMillis
    } else {
      10000L
    }

  private val shutdownWhenNoSessions: Boolean =
    if (config.hasPath("omega-edit.grpc.heartbeat.shutdown-when-no-sessions")) {
      config.getBoolean("omega-edit.grpc.heartbeat.shutdown-when-no-sessions")
    } else {
      false
    }

  private val requireHadSessionBeforeShutdown: Boolean = true

  private val sessionLastSeenMillis = new ConcurrentHashMap[String, java.lang.Long]()
  private val hadAnySession = new AtomicBoolean(false)
  private val shutdownStarted = new AtomicBoolean(false)
  private val lastReapAtMillis = new AtomicLong(0L)
  private val reaper: Option[Cancellable] = startSessionReaper()

  private def touchIfKnown(sessionId: String): Unit =
    if (sessionLastSeenMillis.containsKey(sessionId)) touchSession(sessionId)

  private def touchFromId(id: String): Unit = {
    // Session ids are UUIDs; viewport ids are formatted as "<sessionId>:<viewportId>".
    val sid = id.split(':').headOption.getOrElse(id)
    touchIfKnown(sid)
  }

  lazy val jvmVersion: String = System.getProperty("java.version")
  lazy val jvmVendor: String = System.getProperty("java.vendor")
  lazy val jvmPath: String = System.getProperty("java.home")
  lazy val jvmName: String = ManagementFactory.getRuntimeMXBean().getName()
  lazy val pid: Int = jvmName.split('@')(0).toInt
  lazy val hostname: String = jvmName.split('@')(1)
  lazy val omegaEditVersion: Version = OmegaEdit.version()
  lazy val serverVersion: String = omegaEditVersion.toString
  lazy val availableProcessors: Int = Runtime.getRuntime().availableProcessors()

  private val editors = system.actorOf(Editors.props())
  private var isGracefulShutdown = false

  private def isWindows: Boolean =
    System.getProperty("os.name").toLowerCase.contains("windows")

  def getServerInfo(in: Empty): Future[ServerInfoResponse] =
    Future.successful(
      ServerInfoResponse(
        hostname,
        pid,
        serverVersion,
        jvmVersion,
        jvmVendor,
        jvmPath,
        availableProcessors
      )
    )

  def createSession(in: CreateSessionRequest): Future[CreateSessionResponse] =
    if (isGracefulShutdown) {
      // If server is to shutdown gracefully, don't create new sessions
      Future.successful(CreateSessionResponse("", "", None))
    } else {
      val filePath = in.filePath.map(Paths.get(_))

      // With how omega-edit core works, windows will not support emojis inside of the filename
      if (isWindows && filePath.toString.exists(_.isSurrogate)) {
        throw grpcFailure(Status.INTERNAL, "Emojis in filenames is not supported on Windows")
      }

      val chkptDir = in.checkpointDirectory.map(Paths.get(_))
      (editors ? Create(in.sessionIdDesired, filePath, chkptDir))
        .mapTo[Result]
        .map {
          case ok: Ok with CheckpointDirectory =>
            hadAnySession.set(true)
            touchSession(ok.id)
            filePath match {
              // If a file path is provided, add the file size to the response
              case Some(_) =>
                CreateSessionResponse(
                  ok.id,
                  ok.checkpointDirectory.toString,
                  Option(ok.fileSize)
                )
              case None => CreateSessionResponse(ok.id, ok.checkpointDirectory.toString, None)
            }
          case Ok(id) =>
            throw grpcFailure(Status.INTERNAL, s"didn't receive checkpoint directory for session '$id'")
          case Err(c) => throw grpcFailure(c)
        }
        .recover { case ex: Throwable =>
          throw grpcFailure(Status.INTERNAL, s"Failed to create session: ${ex.getMessage}")
        }
    }

  def destroySession(in: ObjectId): Future[ObjectId] =
    // First destroy the session, then destroy the actor
    (editors ? SessionOp(in.id, Destroy)).mapTo[Result].flatMap {
      case Ok(id) =>
        (editors ? DestroyActor(id, timeout)).mapTo[Result].map {
          case Ok(_) =>
            sessionLastSeenMillis.remove(id)
            // If after session is destroyed, the number of sessions is 0 and the server is to shutdown gracefully,
            // stop server after destroying the last session
            checkIsGracefulShutdown()
            maybeAutoShutdownIfIdle()
            in
          case Err(c) => throw grpcFailure(c)
        }
      case Err(c) => throw grpcFailure(c)
    }

  def checkIsGracefulShutdown(
      kind: ServerControlKind = ServerControlKind.SERVER_CONTROL_GRACEFUL_SHUTDOWN
  ): Future[ServerControlResponse] =
    isGracefulShutdown match {
      case true =>
        checkNoSessionsRunning()
          .map(isZero =>
            isZero match {
              case true  => stopServer(kind)
              case false => ServerControlResponse(kind, getServerPID(), 1)
            }
          )
          .mapTo[ServerControlResponse]
      case false =>
        Future.successful(ServerControlResponse(kind, getServerPID(), 1))
    }

  def checkNoSessionsRunning(): Future[Boolean] =
    (editors ? SessionCount)
      .mapTo[Int]
      .map(count =>
        count compare 0 match {
          case 0 => true
          case _ => false
        }
      )

  def stopServer(kind: ServerControlKind): Future[ServerControlResponse] = {
    reaper.foreach(_.cancel())
    system
      .terminate()
      .transform {
        case Success(_) =>
          // Server stopped successfully, send response and terminate process
          val response = ServerControlResponse(kind, getServerPID(), 0)
          Future {
            // Terminate the JVM process
            System.exit(0)
          }(ExecutionContext.global)
          Success(response)
        case Failure(e) =>
          // Server stop failed, log the error and send error response
          (editors ? LogOp("debug", e))
          val response = ServerControlResponse(kind, getServerPID(), 1)
          Future {
            // Terminate the JVM process with a non-zero status code to indicate error
            System.exit(1)
          }(ExecutionContext.global)
          Success(response)
      }(ExecutionContext.global)

  }

  def saveSession(in: SaveSessionRequest): Future[SaveSessionResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(
      in.sessionId,
      Save(
        Paths.get(in.filePath),
        in.ioFlags,
        in.offset.getOrElse(0L),
        in.length.getOrElse(0L)
      )
    )).mapTo[Result].map {
      case ok: Ok with SavedTo => SaveSessionResponse(ok.id, ok.path.toString, ok.status)
      case Ok(id) =>
        throw grpcFailure(
          Status.INTERNAL,
          s"didn't receive path for save of session '$id'"
        )
      case Err(c) => throw grpcFailure(c)
    }
  }

  def createViewport(in: CreateViewportRequest): Future[ViewportDataResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(
      in.sessionId,
      View(in.offset, in.capacity, in.isFloating, in.viewportIdDesired)
    )).mapTo[Result]
      .flatMap {
        case Ok(id) => getViewportData(ViewportDataRequest(id))
        case Err(c) => Future.failed(grpcFailure(c))
      }
  }

  def getViewportData(in: ViewportDataRequest): Future[ViewportDataResponse] = {
    touchFromId(in.viewportId)
    ObjectId(in.viewportId) match {
      case Viewport.Id(sid, vid) =>
        (editors ? ViewportOp(sid, vid, Viewport.Get)).mapTo[Result].map {
          case Err(c) => throw grpcFailure(c)
          case ok: Ok with ViewportData =>
            ViewportDataResponse
              .apply(
                viewportId = in.viewportId,
                offset = ok.offset,
                length = ok.data.size.toLong,
                data = ok.data,
                followingByteCount = ok.followingByteCount
              )
          case Ok(id) =>
            throw grpcFailure(
              Status.INTERNAL,
              s"didn't receive data for viewport '$id'"
            )
        }
      case _ =>
        grpcFailFut(
          Status.INVALID_ARGUMENT,
          s"malformed viewport id '${in.viewportId}'"
        )
    }
  }

  def modifyViewport(
      in: ModifyViewportRequest
  ): Future[ViewportDataResponse] = {
    touchFromId(in.viewportId)
    ObjectId(in.viewportId) match {
      case Viewport.Id(sid, vid) =>
        (editors ? ViewportOp(
          sid,
          vid,
          Viewport.Modify(
            in.offset,
            in.capacity,
            in.isFloating
          )
        )).mapTo[Result].map {
          case ok: Ok with ViewportData =>
            ViewportDataResponse
              .apply(
                viewportId = in.viewportId,
                offset = ok.offset,
                length = ok.data.size.toLong,
                data = ok.data,
                followingByteCount = ok.followingByteCount
              )
          case Ok(id) =>
            throw grpcFailure(
              Status.INTERNAL,
              s"didn't receive data for viewport '$id'"
            )
          case Err(c) => throw grpcFailure(c)
        }
      case _ =>
        grpcFailFut(
          Status.INVALID_ARGUMENT,
          s"malformed viewport id '${in.viewportId}'"
        )
    }
  }

  def destroyViewport(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    in match {
      case Viewport.Id(sid, vid) =>
        (editors ? ViewportOp(sid, vid, Viewport.Destroy)).mapTo[Result].map {
          case Ok(_)  => in
          case Err(c) => throw grpcFailure(c)
        }
      case _ =>
        grpcFailFut(Status.INVALID_ARGUMENT, s"malformed viewport id '$in'")
    }
  }

  def viewportHasChanges(in: ObjectId): Future[BooleanResponse] = {
    touchFromId(in.id)
    in match {
      case Viewport.Id(sid, vid) =>
        (editors ? ViewportOp(sid, vid, Viewport.HasChanges))
          .mapTo[Result]
          .map {
            case ok: Ok with BooleanResult => BooleanResponse(ok.result)
            case Ok(id) =>
              throw grpcFailure(
                Status.INTERNAL,
                s"didn't receive result for viewport '$id'"
              )
            case Err(c) => throw grpcFailure(c)
          }
      case _ =>
        grpcFailFut(Status.INVALID_ARGUMENT, s"malformed viewport id '$in'")
    }
  }

  def notifyChangedViewports(in: ObjectId): Future[IntResponse] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, NotifyChangedViewports)).mapTo[Result].map {
      case ok: Ok with Count => IntResponse(ok.count)
      case Ok(id) =>
        throw grpcFailure(
          Status.INTERNAL,
          s"didn't receive result for session '$id'"
        )
      case Err(c) => throw grpcFailure(c)
    }
  }

  def submitChange(in: ChangeRequest): Future[ChangeResponse] = {
    touchIfKnown(in.sessionId)
    in match {
      case Session.Op(op) =>
        (editors ? SessionOp(in.sessionId, op)).mapTo[Result].flatMap {
          case ok: Ok with Serial =>
            val res = ChangeResponse(ok.id, ok.serial)
            Future.successful(res)
          case Err(c) => grpcFailFut(c)
          case _      => grpcFailFut(Status.UNKNOWN, s"unable to compute $in")
        }
      case _ =>
        grpcFailFut(Status.INVALID_ARGUMENT, "undefined change kind")
    }
  }

  def getChangeDetails(in: SessionEvent): Future[ChangeDetailsResponse] = {
    touchIfKnown(in.sessionId)
    in.serial match {
      case None =>
        grpcFailFut(Status.INVALID_ARGUMENT, "change serial id required")
      case Some(cid) =>
        (editors ? SessionOp(in.sessionId, LookupChange(cid)))
          .mapTo[Result]
          .map {
            case ok: Ok with ChangeDetails => ok.toChangeResponse(in.sessionId)
            case Ok(_) =>
              throw grpcFailure(
                Status.INTERNAL,
                s"didn't receive data for change details of session '${in.sessionId}'"
              )
            case Err(c) => throw grpcFailure(c)
          }
    }
  }

  def getComputedFileSize(in: ObjectId): Future[ComputedFileSizeResponse] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, GetSize)).mapTo[Result].map {
      case ok: Ok with Count => ComputedFileSizeResponse(in.id, ok.count)
      case Err(c)            => throw grpcFailure(c)
      case _                 => throw grpcFailure(Status.UNKNOWN, "unable to compute size")
    }
  }

  def getSessionCount(in: Empty): Future[SessionCountResponse] =
    (editors ? SessionCount)
      .mapTo[Int]
      .map(count => SessionCountResponse(count.toLong))

  def getCount(in: CountRequest): Future[CountResponse] = {

    touchIfKnown(in.sessionId)

    // create a list of futures for each CountKind value in the request
    val futures = in.kind.map {
      case CountKind.COUNT_CHANGES =>
        editors ? SessionOp(in.sessionId, GetNumChanges)
      case CountKind.COUNT_CHECKPOINTS =>
        editors ? SessionOp(in.sessionId, GetNumCheckpoints)
      case CountKind.COUNT_SEARCH_CONTEXTS =>
        editors ? SessionOp(in.sessionId, GetNumSearchContexts)
      case CountKind.COUNT_COMPUTED_FILE_SIZE =>
        editors ? SessionOp(in.sessionId, GetSize)
      case CountKind.COUNT_UNDOS =>
        editors ? SessionOp(in.sessionId, GetNumUndos)
      case CountKind.COUNT_VIEWPORTS =>
        editors ? SessionOp(in.sessionId, GetNumViewports)
      case CountKind.COUNT_CHANGE_TRANSACTIONS =>
        editors ? SessionOp(in.sessionId, GetNumChangeTransactions)
      case CountKind.COUNT_UNDO_TRANSACTIONS =>
        editors ? SessionOp(in.sessionId, GetNumUndoTransactions)
      case CountKind.UNDEFINED_COUNT_KIND =>
        Future.failed(grpcFailure(Status.UNKNOWN, s"undefined kind: $in"))
      case CountKind.Unrecognized(_) =>
        Future.failed(grpcFailure(Status.UNKNOWN, s"unrecognized kind: $in"))
    }

    // execute all futures concurrently and collect the results
    Future
      .sequence(futures)
      .map { results =>
        CountResponse(
          in.sessionId,
          in.kind.zip(results).collect {
            case (kind: CountKind, c: Count) => SingleCount(kind, c.count)
            case (_, Err(c))                 => throw grpcFailure(c)
          }
        )
      }
      .recover { case ex: Exception =>
        throw grpcFailure(Status.UNKNOWN, ex.getMessage)
      }
  }

  def getHeartbeat(in: HeartbeatRequest): Future[HeartbeatResponse] = {
    in.sessionIds.foreach { sid =>
      if (sessionLastSeenMillis.containsKey(sid)) touchSession(sid)
    }
    val memory = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage()
    val numSessions = Await.result((editors ? SessionCount).mapTo[Int].map(_.toInt), 1.second)
    val res = HeartbeatResponse(
      numSessions,
      System.currentTimeMillis(),
      ManagementFactory.getRuntimeMXBean().getUptime(),
      availableProcessors,
      ManagementFactory.getOperatingSystemMXBean().getSystemLoadAverage(),
      memory.getMax(), // maximum memory the JVM can attempt to allocate
      memory.getCommitted(), // memory allocated to the JVM
      memory.getUsed() // memory used by the JVM
    )
    Future.successful(res)
  }

  /** Event streams
    */
  def subscribeToSessionEvents(
      in: EventSubscriptionRequest
  ): Source[SessionEvent, NotUsed] = {
    touchFromId(in.id)
    val f = (editors ? SessionOp(in.id, Session.Watch(in.interest)))
      .mapTo[Result]
      .map {
        case ok: Ok with Session.Events => ok.stream
        case _                          => Source.failed(grpcFailure(Status.UNKNOWN))
      }
    Await.result(f, 1.second)
  }

  def subscribeToViewportEvents(
      in: EventSubscriptionRequest
  ): Source[ViewportEvent, NotUsed] =
    ObjectId(in.id) match {
      case Viewport.Id(sid, vid) =>
        touchFromId(in.id)
        val f =
          (editors ? ViewportOp(sid, vid, Viewport.Watch(in.interest)))
            .mapTo[Result]
            .map {
              case ok: Ok with Viewport.Events => ok.stream
              case _                           => Source.failed(grpcFailure(Status.UNKNOWN))
            }
        Await.result(f, 1.second)
      case _ =>
        Source.failed(
          new GrpcServiceException(
            Status.INVALID_ARGUMENT.withDescription(
              s"malformed viewport id '${in.id}'"
            )
          )
        )
    }

  def unsubscribeToSessionEvents(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.Unwatch)).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }
  }

  def unsubscribeToViewportEvents(in: ObjectId): Future[ObjectId] =
    ObjectId(in.id) match {
      case Viewport.Id(sid, vid) =>
        touchFromId(in.id)
        (editors ? ViewportOp(sid, vid, Viewport.Unwatch)).mapTo[Result].map {
          case Ok(_)  => in
          case Err(c) => throw grpcFailure(c)
        }
      case _ =>
        throw new GrpcServiceException(
          Status.INVALID_ARGUMENT.withDescription(
            s"malformed viewport id '${in.id}'"
          )
        )
    }

  def getByteFrequencyProfile(in: SegmentRequest): Future[ByteFrequencyProfileResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(in.sessionId, Session.Profile(in)))
      .mapTo[ByteFrequencyProfileResponse] // No `Ok` wrapper
  }

  def getCharacterCounts(in: omega_edit.TextRequest): Future[CharacterCountResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(in.sessionId, Session.CharCount(in)))
      .mapTo[CharacterCountResponse] // No `Ok` wrapper
  }

  def searchSession(in: SearchRequest): Future[SearchResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(in.sessionId, Session.Search(in)))
      .mapTo[SearchResponse] // No `Ok` wrapper
  }

  def undoLastChange(in: ObjectId): Future[ChangeResponse] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.UndoLast())).mapTo[Result].map {
      case ok: Ok with Serial => ChangeResponse(ok.id, ok.serial)
      case Err(c)             => throw grpcFailure(c)
      case _                  => throw grpcFailure(Status.UNKNOWN, s"unable to compute $in")
    }
  }

  def redoLastUndo(in: ObjectId): Future[ChangeResponse] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.RedoUndo())).mapTo[Result].map {
      case ok: Ok with Serial => ChangeResponse(ok.id, ok.serial)
      case Err(c)             => throw grpcFailure(c)
      case _                  => throw grpcFailure(Status.UNKNOWN, s"unable to compute $in")
    }
  }

  def clearChanges(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.ClearChanges())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }
  }

  def getLastChange(in: ObjectId): Future[ChangeDetailsResponse] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.GetLastChange()))
      .mapTo[Result]
      .map {
        case ok: Ok with ChangeDetails =>
          ok.toChangeResponse(ok.id)
        case Err(c) => throw grpcFailure(c)
        case o =>
          throw grpcFailure(Status.UNKNOWN, s"unable to compute $in: $o")
      }
  }

  def getLastUndo(in: ObjectId): Future[ChangeDetailsResponse] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.GetLastUndo())).mapTo[Result].map {
      case ok: Ok with ChangeDetails => ok.toChangeResponse(ok.id)
      case Err(c)                    => throw grpcFailure(c)
      case _                         => throw grpcFailure(Status.UNKNOWN, s"unable to compute $in")
    }
  }

  def pauseSessionChanges(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.PauseSession())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }
  }

  def resumeSessionChanges(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.ResumeSession())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }
  }

  def pauseViewportEvents(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.PauseViewportEvents()))
      .mapTo[Result]
      .map {
        case Ok(id) => ObjectId(id)
        case Err(c) => throw grpcFailure(c)
      }
  }

  def resumeViewportEvents(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.ResumeViewportEvents()))
      .mapTo[Result]
      .map {
        case Ok(id) => ObjectId(id)
        case Err(c) => throw grpcFailure(c)
      }
  }

  def sessionBeginTransaction(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.BeginTransaction())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }
  }

  def sessionEndTransaction(in: ObjectId): Future[ObjectId] = {
    touchFromId(in.id)
    (editors ? SessionOp(in.id, Session.EndTransaction())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }
  }

  def getSegment(in: SegmentRequest): Future[SegmentResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(in.sessionId, Session.Segment(in)))
      .mapTo[Option[api.Segment]] // No `Ok` wrapper
      .flatMap {
        case None =>
          grpcFailFut[SegmentResponse](
            Status.NOT_FOUND,
            s"couldn't find segment: $in"
          )
        case Some(api.Segment(offset, data)) =>
          Future.successful(
            SegmentResponse.of(in.sessionId, offset, ByteString.copyFrom(data))
          )
      }
  }

  def serverControl(in: ServerControlRequest): Future[ServerControlResponse] =
    in.kind match {
      case ServerControlKind.SERVER_CONTROL_GRACEFUL_SHUTDOWN =>
        isGracefulShutdown = true
        checkIsGracefulShutdown()
      case ServerControlKind.SERVER_CONTROL_IMMEDIATE_SHUTDOWN =>
        (editors ? DestroyActors())
          .andThen(_ => stopServer(in.kind))
          .mapTo[ServerControlResponse]
      case ServerControlKind.SERVER_CONTROL_UNDEFINED | ServerControlKind.Unrecognized(_) =>
        Future.failed(
          grpcFailure(Status.UNKNOWN, s"undefined kind: ${in.kind}")
        )
    }

  def getByteOrderMark(in: SegmentRequest): Future[ByteOrderMarkResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(in.sessionId, Session.ByteOrderMark(in)))
      .mapTo[ByteOrderMarkResponse] // No `Ok` wrapper
  }

  def getContentType(in: SegmentRequest): Future[ContentTypeResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(in.sessionId, Session.ContentType(in)))
      .mapTo[ContentTypeResponse] // No `Ok` wrapper
  }

  def getLanguage(in: TextRequest): Future[LanguageResponse] = {
    touchIfKnown(in.sessionId)
    (editors ? SessionOp(in.sessionId, Session.Language(in)))
      .mapTo[LanguageResponse] // No `Ok` wrapper
  }

  private def touchSession(sessionId: String): Unit =
    sessionLastSeenMillis.put(sessionId, System.currentTimeMillis())

  private def maybeAutoShutdownIfIdle(): Unit = {
    if (!shutdownWhenNoSessions) return
    if (requireHadSessionBeforeShutdown && !hadAnySession.get()) return
    if (shutdownStarted.get()) return

    checkNoSessionsRunning().foreach { isZero =>
      if (isZero && shutdownStarted.compareAndSet(false, true)) {
        stopServer(ServerControlKind.SERVER_CONTROL_GRACEFUL_SHUTDOWN)
        ()
      }
    }
  }

  private def startSessionReaper(): Option[Cancellable] = {
    if (sessionTimeoutMillis <= 0L) return None

    val intervalMillis = math.max(50L, cleanupIntervalMillis)
    val cancellable =
      system.scheduler.scheduleAtFixedRate(
        initialDelay = intervalMillis.millis,
        interval = intervalMillis.millis
      )(() => reapStaleSessions())

    system.registerOnTermination(() => cancellable.cancel())
    Some(cancellable)
  }

  private def reapStaleSessions(): Unit = {
    val now = System.currentTimeMillis()

    // Avoid running too frequently if interval is tiny
    val last = lastReapAtMillis.get()
    if (last != 0L && now - last < cleanupIntervalMillis) return
    lastReapAtMillis.set(now)

    val timeoutMillis = sessionTimeoutMillis
    if (timeoutMillis <= 0L) return

    val stale = sessionLastSeenMillis.asScala.collect {
      case (sid, lastSeen) if now - lastSeen.longValue() > timeoutMillis => (sid, lastSeen)
    }.toList

    stale.foreach { case (sid, lastSeen) =>
      // Conditionally remove only if the lastSeen value has not changed, to avoid racing with touchSession
      val removed = sessionLastSeenMillis.remove(sid, lastSeen)
      if (removed) {
        destroySession(ObjectId(sid)).onComplete {
          case Success(_) =>
            maybeAutoShutdownIfIdle()
          case Failure(_) =>
            // Re-add the session if it is still absent so that a transient failure does not prevent future reaping.
            // Do not overwrite any newer lastSeen value that may have been set concurrently.
            sessionLastSeenMillis.putIfAbsent(sid, java.lang.Long.valueOf(now))
        }
      }
    }
  }
}

object EditorService {
  def bind(iface: String, port: Int)(implicit system: ActorSystem): Future[Http.ServerBinding] = {
    implicit val ec: ExecutionContext = system.dispatcher
    Http()
      .newServerAt(iface, port)
      .bind(EditorHandler(new EditorService))
      .andThen { case Failure(_) =>
        system.terminate()
      }
  }

  def bindUnixSocket(socketPath: java.nio.file.Path)(implicit
      system: ActorSystem
  ): Future[Http.ServerBinding] = {
    implicit val ec: ExecutionContext = system.dispatcher

    if (!UnixDomainSocketProxy.isSupportedByRuntime)
      return Future.failed(
        new IllegalStateException(
          "Unix domain sockets are not supported by this runtime (requires Java 16+ and a Unix-like OS)."
        )
      )

    val address = UnixDomainSocketProxy.addressOf(socketPath)
    val http = Http()
    val handler = EditorHandler(new EditorService)

    val newServerAtMethod = http.getClass.getMethods
      .find(m => m.getName == "newServerAt" && m.getParameterCount == 1)
      .filter { m =>
        classOf[SocketAddress].isAssignableFrom(m.getParameterTypes.apply(0))
      }

    val builder = newServerAtMethod match {
      case Some(m) => m.invoke(http, address)
      case None =>
        return Future.failed(
          new IllegalStateException(
            "This Pekko HTTP version does not support binding to Unix domain sockets."
          )
        )
    }

    val bindMethod = builder.getClass.getMethods.find { m =>
      m.getName == "bind" && m.getParameterCount == 1 && {
        // Disambiguate by checking that the parameter is a handler function type.
        // Pekko HTTP ServerBuilder has multiple bind overloads (e.g., handler vs Route),
        // both of which erase to Function1. We check the generic type parameter to ensure
        // we're binding to the correct overload: Function1 with HttpRequest as first type arg.
        val paramTypes = m.getGenericParameterTypes
        if (paramTypes.isEmpty) false
        else {
          val firstParam = paramTypes(0).getTypeName
          // Check if it's a Function1 with HttpRequest as the input type
          firstParam.contains("Function1") && firstParam.contains("HttpRequest")
        }
      }
    }

    bindMethod match {
      case Some(m) =>
        m.invoke(builder, handler)
          .asInstanceOf[Future[Http.ServerBinding]]
          .andThen { case Failure(_) =>
            system.terminate()
          }
      case None =>
        Future.failed(
          new IllegalStateException(
            "Unable to locate server binding method for Unix domain socket binding."
          )
        )
    }
  }

  def getServerPID(): Int =
    ManagementFactory.getRuntimeMXBean().getName().split('@')(0).toInt

  private def grpcFailFut[T](status: Status, message: String = ""): Future[T] =
    Future.failed(grpcFailure(status, message))

  private def grpcFailure(
      status: Status,
      message: String = ""
  ): GrpcServiceException =
    new GrpcServiceException(
      if (message.nonEmpty) status.withDescription(message) else status
    )
}
