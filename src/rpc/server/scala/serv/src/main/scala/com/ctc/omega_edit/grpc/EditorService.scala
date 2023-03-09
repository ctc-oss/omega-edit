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

import akka.NotUsed
import akka.actor.ActorSystem
import akka.grpc.GrpcServiceException
import akka.http.scaladsl.Http
import akka.pattern.ask
import akka.stream.scaladsl.Source
import akka.util.Timeout
import com.ctc.omega_edit.api
import com.ctc.omega_edit.api.OmegaEdit
import com.ctc.omega_edit.api.Session.OverwriteStrategy
import com.ctc.omega_edit.grpc.EditorService._
import com.ctc.omega_edit.grpc.Editors._
import com.ctc.omega_edit.grpc.Session._
import com.google.protobuf.ByteString
import com.google.protobuf.empty.Empty
import io.grpc.Status
import omega_edit._

import java.nio.file.Paths
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

import scala.util.{Failure, Success}
import scala.concurrent.ExecutionContext.Implicits.global

import scala.concurrent.ExecutionContext
import java.lang.management.ManagementFactory

class EditorService(implicit val system: ActorSystem) extends Editor {
  private implicit val timeout: Timeout = Timeout(5.seconds)
  private val editors = system.actorOf(Editors.props())
  private var isGracefulShutdown = false
  import system.dispatcher

  def getVersion(in: Empty): Future[VersionResponse] = {
    val v = OmegaEdit.version()
    Future.successful(VersionResponse(v.major, v.minor, v.patch))
  }

  def createSession(in: CreateSessionRequest): Future[CreateSessionResponse] =
    isGracefulShutdown match {
      case false =>
        (editors ? Create(
          in.sessionIdDesired,
          in.filePath.map(Paths.get(_))
        )).mapTo[Result]
          .map {
            case Ok(id) => CreateSessionResponse(id)
            case Err(c) => throw grpcFailure(c)
          }
      case true => Future.successful(CreateSessionResponse(""))
    }

  def destroySession(in: ObjectId): Future[ObjectId] =
    // If after session is destroyed, the number of sessions is 0
    // and the server is to shutdown gracefully, stop server after destroy
    (editors ? DestroyActor(in.id, timeout))
      .mapTo[Result]
      .map {
        case Ok(_) => {
          checkIsGracefulShutdown()
          in
        }
        case Err(c) => throw grpcFailure(c)
      }

  def saveSession(in: SaveSessionRequest): Future[SaveSessionResponse] =
    (editors ? SessionOp(
      in.sessionId,
      Save(
        Paths.get(in.filePath),
        if (in.allowOverwrite.getOrElse(true))
          OverwriteStrategy.OverwriteExisting
        else OverwriteStrategy.GenerateFilename
      )
    )).mapTo[Result].map {
      case ok: Ok with SavedTo => SaveSessionResponse(ok.id, ok.path.toString)
      case Ok(id) =>
        throw grpcFailure(
          Status.INTERNAL,
          s"didn't receive path for save of session $id"
        )
      case Err(c) => throw grpcFailure(c)
    }

  def createViewport(in: CreateViewportRequest): Future[ViewportDataResponse] =
    (editors ? SessionOp(
      in.sessionId,
      View(in.offset, in.capacity, in.isFloating, in.viewportIdDesired)
    )).mapTo[Result]
      .flatMap {
        case Ok(id) => getViewportData(ViewportDataRequest(id))
        case Err(c) => Future.failed(grpcFailure(c))
      }

  def modifyViewport(
      in: ModifyViewportRequest
  ): Future[ViewportDataResponse] =
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
              s"didn't receive data for viewport $id"
            )
          case Err(c) => throw grpcFailure(c)
        }
      case _ => grpcFailFut(Status.INVALID_ARGUMENT, "malformed viewport id")
    }

  def destroyViewport(in: ObjectId): Future[ObjectId] =
    in match {
      case Viewport.Id(sid, vid) =>
        (editors ? ViewportOp(sid, vid, Viewport.Destroy)).mapTo[Result].map {
          case Ok(_)  => in
          case Err(c) => throw grpcFailure(c)
        }
      case _ => grpcFailFut(Status.INVALID_ARGUMENT, "malformed viewport id")
    }

  def viewportHasChanges(in: ObjectId): Future[BooleanResponse] =
    in match {
      case Viewport.Id(sid, vid) =>
        (editors ? ViewportOp(sid, vid, Viewport.HasChanges))
          .mapTo[Result]
          .map {
            case ok: Ok with BooleanResult => BooleanResponse(ok.result)
            case Ok(id) =>
              throw grpcFailure(
                Status.INTERNAL,
                s"didn't receive result for viewport $id"
              )
            case Err(c) => throw grpcFailure(c)
          }
      case _ => grpcFailFut(Status.INVALID_ARGUMENT, "malformed viewport id")
    }

  def notifyChangedViewports(in: ObjectId): Future[IntResponse] =
    (editors ? SessionOp(in.id, NotifyChangedViewports)).mapTo[Result].map {
      case ok: Ok with Count => IntResponse(ok.count)
      case Ok(id) =>
        throw grpcFailure(
          Status.INTERNAL,
          s"didn't receive result for session $id"
        )
      case Err(c) => throw grpcFailure(c)
    }

  def getViewportData(in: ViewportDataRequest): Future[ViewportDataResponse] =
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
              s"didn't receive data for viewport $id"
            )
        }
      case _ => grpcFailFut(Status.INVALID_ARGUMENT, "malformed viewport id")
    }

  def submitChange(in: ChangeRequest): Future[ChangeResponse] =
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

  def getChangeDetails(in: SessionEvent): Future[ChangeDetailsResponse] =
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
                s"didn't receive data for change details of session ${in.sessionId}"
              )
            case Err(c) => throw grpcFailure(c)
          }
    }

  def getComputedFileSize(in: ObjectId): Future[ComputedFileSizeResponse] =
    (editors ? SessionOp(in.id, GetSize)).mapTo[Result].map {
      case ok: Ok with Count => ComputedFileSizeResponse(in.id, ok.count)
      case Err(c)            => throw grpcFailure(c)
      case _ => throw grpcFailure(Status.UNKNOWN, "unable to compute size")
    }

  def getSessionCount(in: Empty): Future[SessionCountResponse] =
    (editors ? SessionCount)
      .mapTo[Int]
      .map(count => SessionCountResponse(count.toLong))

  def getCount(in: CountRequest): Future[CountResponse] = {

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

  /** Event streams
    */
  def subscribeToSessionEvents(
      in: EventSubscriptionRequest
  ): Source[SessionEvent, NotUsed] = {
    val f = (editors ? SessionOp(in.id, Session.Watch(in.interest)))
      .mapTo[Result]
      .map {
        case ok: Ok with Session.Events => ok.stream
        case _ => Source.failed(grpcFailure(Status.UNKNOWN))
      }
    Await.result(f, 1.second)
  }

  def subscribeToViewportEvents(
      in: EventSubscriptionRequest
  ): Source[ViewportEvent, NotUsed] =
    ObjectId(in.id) match {
      case Viewport.Id(sid, vid) =>
        val f =
          (editors ? ViewportOp(sid, vid, Viewport.Watch(in.interest)))
            .mapTo[Result]
            .map {
              case ok: Ok with Viewport.Events => ok.stream
              case _ => Source.failed(grpcFailure(Status.UNKNOWN))
            }
        Await.result(f, 1.second)
      case _ =>
        Source.failed(
          new GrpcServiceException(
            Status.INVALID_ARGUMENT.withDescription("malformed viewport id")
          )
        )
    }

  def unsubscribeToSessionEvents(in: ObjectId): Future[ObjectId] =
    (editors ? SessionOp(in.id, Session.Unwatch)).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }

  def unsubscribeToViewportEvents(in: ObjectId): Future[ObjectId] =
    ObjectId(in.id) match {
      case Viewport.Id(sid, vid) =>
        (editors ? ViewportOp(sid, vid, Viewport.Unwatch)).mapTo[Result].map {
          case Ok(id) => ObjectId(id)
          case Err(c) => throw grpcFailure(c)
        }
      case _ =>
        throw new GrpcServiceException(
          Status.INVALID_ARGUMENT.withDescription("malformed viewport id")
        )
    }

  // profile

  def getByteFrequencyProfile(
      in: ByteFrequencyProfileRequest
  ): Future[ByteFrequencyProfileResponse] =
    (editors ? SessionOp(in.sessionId, Session.Profile(in)))
      .mapTo[ByteFrequencyProfileResponse] // No `Ok` wrapper

  // search

  def searchSession(in: SearchRequest): Future[SearchResponse] =
    (editors ? SessionOp(in.sessionId, Session.Search(in)))
      .mapTo[SearchResponse] // No `Ok` wrapper

  // undo redo

  def undoLastChange(in: ObjectId): Future[ChangeResponse] =
    (editors ? SessionOp(in.id, Session.UndoLast())).mapTo[Result].map {
      case ok: Ok with Serial => ChangeResponse(ok.id, ok.serial)
      case Err(c)             => throw grpcFailure(c)
      case _ => throw grpcFailure(Status.UNKNOWN, s"unable to compute $in")
    }

  // redo the last undo

  def redoLastUndo(in: ObjectId): Future[ChangeResponse] =
    (editors ? SessionOp(in.id, Session.RedoUndo())).mapTo[Result].map {
      case ok: Ok with Serial => ChangeResponse(ok.id, ok.serial)
      case Err(c)             => throw grpcFailure(c)
      case _ => throw grpcFailure(Status.UNKNOWN, s"unable to compute $in")
    }

  // clear changes

  def clearChanges(in: ObjectId): Future[ObjectId] =
    (editors ? SessionOp(in.id, Session.ClearChanges())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }

  // get last change

  def getLastChange(in: ObjectId): Future[ChangeDetailsResponse] =
    (editors ? SessionOp(in.id, Session.GetLastChange()))
      .mapTo[Result]
      .map {
        case ok: Ok with ChangeDetails =>
          ok.toChangeResponse(ok.id)
        case Err(c) => throw grpcFailure(c)
        case o =>
          throw grpcFailure(Status.UNKNOWN, s"unable to compute $in: $o")
      }

  // get last undo

  def getLastUndo(in: ObjectId): Future[ChangeDetailsResponse] =
    (editors ? SessionOp(in.id, Session.GetLastUndo())).mapTo[Result].map {
      case ok: Ok with ChangeDetails => ok.toChangeResponse(ok.id)
      case Err(c)                    => throw grpcFailure(c)
      case _ => throw grpcFailure(Status.UNKNOWN, s"unable to compute $in")
    }

  // pause session changes

  def pauseSessionChanges(in: ObjectId): Future[ObjectId] =
    (editors ? SessionOp(in.id, Session.PauseSession())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }

  // resume session changes

  def resumeSessionChanges(in: ObjectId): Future[ObjectId] =
    (editors ? SessionOp(in.id, Session.ResumeSession())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }

  // pause viewport events

  def pauseViewportEvents(in: ObjectId): Future[ObjectId] =
    (editors ? SessionOp(in.id, Session.PauseViewportEvents()))
      .mapTo[Result]
      .map {
        case Ok(id) => ObjectId(id)
        case Err(c) => throw grpcFailure(c)
      }

  // resume viewport events

  def resumeViewportEvents(in: ObjectId): Future[ObjectId] =
    (editors ? SessionOp(in.id, Session.ResumeViewportEvents()))
      .mapTo[Result]
      .map {
        case Ok(id) => ObjectId(id)
        case Err(c) => throw grpcFailure(c)
      }

  def sessionBeginTransaction(in: ObjectId): Future[ObjectId] =
    (editors ? SessionOp(in.id, Session.BeginTransaction())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }

  def sessionEndTransaction(in: ObjectId): Future[ObjectId] =
    (editors ? SessionOp(in.id, Session.EndTransaction())).mapTo[Result].map {
      case Ok(id) => ObjectId(id)
      case Err(c) => throw grpcFailure(c)
    }

  // segments

  def getSegment(in: SegmentRequest): Future[SegmentResponse] =
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

  // server control

  def checkNoSessionsRunning(): Future[Boolean] =
    (editors ? SessionCount)
      .mapTo[Int]
      .map(count =>
        count compare 0 match {
          case 0 => true
          case _ => false
        }
      )

  def stopServer(kind: ServerControlKind): Future[ServerControlResponse] =
    system
      .terminate()
      .transform {
        case Success(_) =>
          Success(ServerControlResponse(kind, getServerPID(), 0))
        case Failure(e) => {
          (editors ? LogOp("debug", e))
          Success(ServerControlResponse(kind, getServerPID(), 1))
        }
      }(ExecutionContext.global)

  def checkIsGracefulShutdown(
      kind: ServerControlKind =
        ServerControlKind.SERVER_CONTROL_GRACEFUL_SHUTDOWN
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

  def serverControl(in: ServerControlRequest): Future[ServerControlResponse] =
    in.kind match {
      case ServerControlKind.SERVER_CONTROL_GRACEFUL_SHUTDOWN => {
        isGracefulShutdown = true
        checkIsGracefulShutdown()
      }
      case ServerControlKind.SERVER_CONTROL_IMMEDIATE_SHUTDOWN =>
        (editors ? DestroyActors())
          .andThen(_ => stopServer(in.kind))
          .mapTo[ServerControlResponse]
      case ServerControlKind.SERVER_CONTROL_UNDEFINED |
          ServerControlKind.Unrecognized(_) =>
        Future.failed(
          grpcFailure(Status.UNKNOWN, s"undefined kind: ${in.kind}")
        )
    }
}

object EditorService {
  private def grpcFailFut[T](status: Status, message: String = ""): Future[T] =
    Future.failed(grpcFailure(status, message))

  private def grpcFailure(
      status: Status,
      message: String = ""
  ): GrpcServiceException =
    new GrpcServiceException(
      if (message.nonEmpty) status.withDescription(message) else status
    )

  def bind(iface: String, port: Int)(implicit
      system: ActorSystem
  ): Future[Http.ServerBinding] =
    Http()
      .newServerAt(iface, port)
      .bind(EditorHandler(new EditorService))
      .andThen { case Failure(_) =>
        system.terminate()
      }

  def getServerPID(): Int =
    ManagementFactory.getRuntimeMXBean().getName().split('@')(0).toInt
}
