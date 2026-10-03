// Top-level build file. Versions are pinned to a combination known to work
// together; if your installed Android SDK / Gradle differ, bump them in tandem
// (see README — Chaquopy, AGP and Kotlin versions must be compatible).
plugins {
    // Chaquopy 15.0.1 supports Android Gradle plugin up to 8.2, so AGP + Gradle
    // are pinned to that ceiling (Gradle 8.2 via the wrapper).
    id("com.android.application") version "8.2.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
    id("com.chaquo.python") version "15.0.1" apply false
}
