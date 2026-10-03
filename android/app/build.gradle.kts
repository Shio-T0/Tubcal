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
        versionCode = 14
        versionName = "0.4.0"

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

// ---- Embedded Python (Chaquopy) ----
// In the Kotlin DSL this lives in a top-level chaquopy{} block, not in
// android.defaultConfig.python (that accessor only exists in the Groovy DSL).
chaquopy {
    defaultConfig {
        version = "3.11"   // target Python that Chaquopy ships on-device
        // Host interpreter Chaquopy uses to run pip at build time. It must be
        // 3.8–3.12: the machine's default python3 is 3.14, whose stdlib dropped
        // `cgi`, which the pip Chaquopy 15 bundles still imports. Point at any
        // 3.12 (here, a uv-managed one). Adjust this path for your machine.
        buildPython("/home/shio-t0/.local/share/uv/python/cpython-3.12.12-linux-x86_64-gnu/bin/python3.12")
        pip {
            install("flask")
            install("requests")
            install("feedparser")
            install("python-dotenv")
            install("yt-dlp")
            // AES for yt-dlp signatures AND anipy-api's allanime decryption. It's the
            // one native dep here — Chaquopy ships an on-device wheel for it.
            install("pycryptodomex")
            // install("brotli")   // optional: extra yt-dlp speed

            // Anime streaming (server/sources/anime_source.py → anipy-api's allanime
            // scraper). anipy-api's declared deps include native libs with no Chaquopy
            // wheel (Levenshtein + its rapidfuzz backend) and desktop-only ones
            // (python-mpv/libmpv, python-ffmpeg) — none of which the scraper path
            // actually imports. So anipy_api is *vendored* into app/src/main/python
            // (pip never sees those deps), `Levenshtein` is shadowed by a pure-Python
            // shim (app/src/main/python/Levenshtein.py), and here we pip-install only
            // the pure/available runtime deps the scraper genuinely uses.
            install("beautifulsoup4")
            install("dataclasses-json")
            install("m3u8")
            install("pycountry")
            install("simpleeval")
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

// server/ and main.py (as desktop_main.py, whose background jobs android_main.py
// borrows) land in a generated source folder Chaquopy packs with app/src/main/python.
val desktopPython = layout.buildDirectory.dir("generated/desktop-python")
val syncDesktopPython by tasks.registering(Sync::class) {
    from(File(tubcalRoot, "server")) {
        into("server")
        exclude("**/__pycache__/**", "**/*.pyc")
    }
    from(File(tubcalRoot, "main.py")) { rename { "desktop_main.py" } }
    into(desktopPython)
}

// The phone UI (android/phone, which imports frontend/src as @pc), built into the
// APK's assets as web/. The Python side's licence list is refreshed first (it reads
// the previous build's pip output; see tools/gen-licenses.py).
val phoneDir = rootProject.file("phone")
val phoneWeb = layout.buildDirectory.dir("generated/phone-web")
val buildPhoneUi by tasks.registering(Exec::class) {
    workingDir = phoneDir
    commandLine(
        "sh", "-c",
        "python3 ../tools/gen-licenses.py || true; [ -d node_modules ] || npm ci --no-audit --no-fund; npm run build",
    )
    inputs.dir(File(phoneDir, "src"))
    inputs.files(File(phoneDir, "index.html"), File(phoneDir, "vite.config.js"), File(phoneDir, "package.json"))
    inputs.dir(File(phoneDir, "public"))
    inputs.dir(File(tubcalRoot, "frontend/src"))
    inputs.files(File(tubcalRoot, "LICENSE"), File(tubcalRoot, "THIRD_PARTY_NOTICES.md"))
    outputs.dir(phoneWeb)
}

android {
    sourceSets["main"].assets.srcDir(phoneWeb)
}
chaquopy {
    sourceSets {
        getByName("main") {
            srcDir(desktopPython.get().asFile)
        }
    }
}
tasks.named("preBuild") { dependsOn(syncDesktopPython, buildPhoneUi) }
// Gradle wants the readers of generated folders to name their producers outright.
tasks.matching { it.name.contains("Python") && it != syncDesktopPython.get() }
    .configureEach { dependsOn(syncDesktopPython) }
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(buildPhoneUi) }
