// Override dependency scheme to resolve scala-xml version conflicts in project dependencies
// This is needed because pekko-grpc-sbt-plugin 1.2.0 transitively depends on twirl-api 2.0.9
// which requires scala-xml 2.2.0, but other sbt plugins require older versions.
libraryDependencySchemes += "org.scala-lang.modules" %% "scala-xml" % VersionScheme.Always
