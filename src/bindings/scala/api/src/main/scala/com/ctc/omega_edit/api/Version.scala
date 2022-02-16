package com.ctc.omega_edit.api

case class Version(major: Int, minor: Int, patch: Int) {
  override def toString: String = s"v$major.$minor.$patch"
}
