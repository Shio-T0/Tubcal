plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.chaquo.python")
}

android {
    namespace = "com.tubcal.app"
    compileSdk = 34
    ndkVersion = "26.1.10909125"

    defaultConfig {
        applicationId = "com.tubcal.app"
        minSdk = 26          // Android 8.0 — needed for notification channels & modern WebView
        targetSdk = 34
        // 16 / 0.6.0: the first build split into a core APK and one APK per room
        // (install.sh's PHONE_SPLIT_SINCE)
        versionCode = 16
        versionName = "0.6.0"

        // Chaquopy must build for the ABIs you'll run on. arm64 covers every
        // modern phone; x86_64 covers the emulator. (More ABIs = bigger APK.)
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// Host interpreter Chaquopy uses to run pip at build time, and tools/rooms.py for
// the rooms' packages. It must be 3.8–3.12: the machine's default python3 is 3.14,
// whose stdlib dropped `cgi`, which the pip Chaquopy 15 bundles still imports.
// Point at any 3.12 (here, a uv-managed one). Adjust this path for your machine.
val buildPy = "/home/shio-t0/.local/share/uv/python/cpython-3.12.12-linux-x86_64-gnu/bin/python3.12"

// ---- Embedded Python (Chaquopy) ----
// In the Kotlin DSL this lives in a top-level chaquopy{} block, not in
// android.defaultConfig.python (that accessor only exists in the Groovy DSL).
chaquopy {
    defaultConfig {
        version = "3.11"   // target Python that Chaquopy ships on-device
        buildPython(buildPy)
        // The core's packages only. A room's are in its split APK (modules.ini
        // `phone_pip`: yt-dlp for the Screening Room, the scraper's packages for the
        // Anime), installed by tools/rooms.py.
        pip {
            install("flask")
            install("requests")
            install("feedparser")
            install("python-dotenv")
            // AES for yt-dlp and for anipy-api's sources. It's the one native package,
            // so it stays in the core APK: a split APK can only carry pure Python.
            install("pycryptodomex")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}

// ---- The desktop app, straight from this repo ----
// Nothing of the desktop is copied into android/: the build takes it from the repo
// root each time, so the APK always runs the server and UI code beside it.
val tubcalRoot: File = rootProject.projectDir.parentFile

// The rooms (modules.ini). The core APK holds none of a room's files: each room
// the phone can have is a split APK of its own (tools/rooms.py), and a room marked
// `phone = no` isn't in the app at all. These are the paths every room owns.
val roomPaths: List<String> = run {
    val out = mutableListOf<String>()
    var room = false
    var inPaths = false
    val section = mutableListOf<String>()
    fun flush() { if (room) out += section; section.clear() }
    File(tubcalRoot, "modules.ini").forEachLine { line ->
        when {
            line.isBlank() || line.trimStart().startsWith("#") -> {}
            line.startsWith("[") -> { flush(); room = false; inPaths = false }
            line[0].isWhitespace() -> if (inPaths) section += line.trim()
            else -> {
                val key = line.substringBefore("=").trim()
                if (key == "name") room = true
                inPaths = key == "paths"
            }
        }
    }
    flush()
    out
}
// a room's paths under `prefix`, as Gradle excludes ("editor/**" for a folder)
fun roomExcludes(prefix: String) = roomPaths.filter { it.startsWith(prefix) }
    .map { it.removePrefix(prefix).let { p -> if (p.endsWith("/")) "$p**" else p } }

// The core's Python: server/ less the rooms' files, main.py (as desktop_main.py,
// whose background jobs android_main.py borrows) and app/src/main/python less the
// rooms' files (the vendored anime scrapers, the yt-dlp shim), in one generated
// folder that is Chaquopy's only source. modules.ini goes inside server/, where
// server/modules.py reads it as package data.
val desktopPython = layout.buildDirectory.dir("generated/desktop-python")
val syncDesktopPython by tasks.registering(Sync::class) {
    from(File(tubcalRoot, "server")) {
        into("server")
        exclude("**/__pycache__/**", "**/*.pyc")
        exclude(roomExcludes("server/"))
    }
    from(File(tubcalRoot, "modules.ini")) { into("server") }
    from(File(tubcalRoot, "main.py")) { rename { "desktop_main.py" } }
    from(file("src/main/python")) {
        exclude("**/__pycache__/**", "**/*.pyc")
        exclude(roomExcludes("android/app/src/main/python/"))
    }
    into(desktopPython)
}

// Each room's Python (its server files, its share of app/src/main/python and its
// pip packages) into generated/room-python/<id>, for its split APK.
val roomPython = layout.buildDirectory.dir("generated/room-python")
val gatherRoomPython by tasks.registering(Exec::class) {
    commandLine("python3", "../tools/rooms.py", "python", "--python", buildPy)
    inputs.file(rootProject.file("tools/rooms.py"))
    inputs.file(File(tubcalRoot, "modules.ini"))
    inputs.dir(File(tubcalRoot, "server"))
    inputs.dir(file("src/main/python"))
    outputs.dir(roomPython)
}

// The phone UI (android/phone, which imports frontend/src as @pc), built into the
// APK's assets as web/, less each room's files (phone/rooms.mjs puts those in
// generated/phone-rooms/<id>, for its split APK). The Python side's licence list
// is refreshed first (it reads the previous build's pip output and the rooms'
// packages; see tools/gen-licenses.py).
val phoneDir = rootProject.file("phone")
val phoneWeb = layout.buildDirectory.dir("generated/phone-web")
val phoneRooms = layout.buildDirectory.dir("generated/phone-rooms")
val buildPhoneUi by tasks.registering(Exec::class) {
    dependsOn(gatherRoomPython)
    workingDir = phoneDir
    commandLine(
        "sh", "-c",
        "python3 ../tools/gen-licenses.py || true; [ -d node_modules ] || npm ci --no-audit --no-fund; npm run build",
    )
    inputs.dir(File(phoneDir, "src"))
    inputs.files(File(phoneDir, "index.html"), File(phoneDir, "vite.config.js"), File(phoneDir, "rooms.mjs"), File(phoneDir, "package.json"))
    inputs.dir(File(phoneDir, "public"))
    inputs.dir(File(tubcalRoot, "frontend/src"))
    inputs.files(File(tubcalRoot, "LICENSE"), File(tubcalRoot, "THIRD_PARTY_NOTICES.md"), File(tubcalRoot, "modules.ini"))
    outputs.dir(phoneWeb)
    outputs.dir(phoneRooms)
}

// After the core APK: a split APK per room beside it, in outputs/rooms/
// (room_<id>.apk, same version and debug key). `tubcal phone` installs the core
// APK with the rooms you pick; `adb install-multiple` with all of them is every room.
val assembleRooms by tasks.registering(Exec::class) {
    val apk = layout.buildDirectory.file("outputs/apk/debug/app-debug.apk")
    dependsOn(gatherRoomPython, buildPhoneUi)
    mustRunAfter("packageDebug")
    commandLine("python3", "../tools/rooms.py", "apks", apk.get().asFile.path)
    inputs.file(rootProject.file("tools/rooms.py"))
    inputs.file(apk)
    inputs.dir(roomPython)
    inputs.dir(phoneRooms)
    outputs.dir(layout.buildDirectory.dir("outputs/rooms"))
}
tasks.matching { it.name == "assembleDebug" }.configureEach { finalizedBy(assembleRooms) }

android {
    sourceSets["main"].assets.srcDir(phoneWeb)
}
chaquopy {
    sourceSets {
        getByName("main") {
            setSrcDirs(listOf(desktopPython.get().asFile))
        }
    }
}
tasks.named("preBuild") { dependsOn(syncDesktopPython, buildPhoneUi) }
// Gradle wants the readers of generated folders to name their producers outright.
tasks.matching { it.name.contains("Python") && it != syncDesktopPython.get() && it != gatherRoomPython.get() }
    .configureEach { dependsOn(syncDesktopPython) }
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(buildPhoneUi) }
