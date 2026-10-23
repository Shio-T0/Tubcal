#!/bin/sh
# shellcheck shell=bash
#
# Tubcal installer: tunes a Linux machine in to Tubcal.
#
#   ./install.sh        from a checkout: sets that checkout up where it is
#   curl -fsSL https://raw.githubusercontent.com/Shio-T0/Tubcal/main/install.sh | bash
#                       from anywhere: clones into ~/.local/share/tubcal/app
#
# You pick the rooms to install (modules.ini lists them); a room left out is
# never downloaded: the clone is sparse and partial, so its files, its Python
# packages and its pages stay off this machine. `tubcal add <room>` and
# `tubcal remove <room>` change the choice later.
#
# In order: distro packages (listed and asked about first; sudo is used for
# nothing else) → Tubcal itself (only the rooms you picked) → uv → Node.js →
# Python + the backend (uv sync) → the frontend build → a private,
# self-updating yt-dlp (with the Screening Room) → the `tubcal` launcher,
# app-menu entry and optional login autostart → a self-test against a
# throwaway database → if a phone is plugged in, an offer to put Tubcal for
# Android on it too (what `tubcal phone` does any time).
#
# Fedora (Fedora Asahi Remix on Apple Silicon included), RHEL/Alma/Rocky,
# Debian/Ubuntu/Mint/Pop!_OS, Arch/Manjaro/EndeavourOS/CachyOS, openSUSE,
# Alpine, Void, and image-based Fedoras (Silverblue, Kinoite, Bazzite). Anything
# else, or no root, takes the user-space path: uv, a private Node and a
# uv-managed Python, all under your home. `./install.sh --help` lists the flags.

# Plain sh up to here, so `sh install.sh` re-runs itself under bash and a
# bash-less system gets a sentence instead of a syntax error.
if [ -z "${BASH_VERSION:-}" ]; then
  if [ -f "$0" ] && command -v bash >/dev/null 2>&1; then exec bash "$0" "$@"; fi
  echo "Tubcal's installer needs bash (on Alpine: apk add bash), then run it with bash." >&2
  exit 1
fi
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  echo "Tubcal's installer needs bash 4 or newer." >&2
  exit 1
fi

set -uo pipefail
shopt -s extglob

TUBCAL_REPO=${TUBCAL_REPO:-https://github.com/Shio-T0/Tubcal.git}
TUBCAL_BRANCH=${TUBCAL_BRANCH:-main}
NODE_MIN=20   # Vite 6 builds on 18; yt-dlp's YouTube JS solver wants 20+
NODE_MAJOR=24 # the private Node, when the distro's is missing or too old
UV_MIN=0.8.0  # oldest uv that reads this repo's uv.lock

XDG_DATA=${XDG_DATA_HOME:-$HOME/.local/share}
XDG_CONF=${XDG_CONFIG_HOME:-$HOME/.config}
STATE_DIR=${XDG_STATE_HOME:-$HOME/.local/state}/tubcal
TUBCAL_HOME=${TUBCAL_HOME:-$XDG_DATA/tubcal} # installer-owned: private tools + install record
BIN_DIR=${TUBCAL_BIN_DIR:-$HOME/.local/bin}
APPS_DIR=$XDG_DATA/applications
ICON_DIR=$XDG_DATA/icons/hicolor/scalable/apps
UNIT_DIR=$XDG_CONF/systemd/user
CONF=$TUBCAL_HOME/install.conf

# ── arguments ────────────────────────────────────────────────────────────────

MODE=install YES=0 NO_SUDO=0 PURGE=0 ANIM=1 NOCOLOR_FLAG=0 CLONE_DIR="" EXACT=""
APK_FILE="" REPLACE=0 # --phone: --apk FILE, --replace
declare -A FORCE=()
CHANGE_ADD=() CHANGE_REMOVE=() # --add / --remove: rooms, as typed

usage() {
  cat <<'EOF'
Tubcal installer

  ./install.sh [options]
  curl -fsSL https://raw.githubusercontent.com/Shio-T0/Tubcal/main/install.sh | bash -s -- [options]

Options
  -y, --yes            no questions: the defaults, or what you chose last time
      --rooms LIST     install exactly these rooms, comma-separated (see below)
      --with LIST      switch on rooms or options, comma-separated
      --without LIST   switch off any of the same
      --dir DIR        where to clone Tubcal when not run from a checkout
                       (default ~/.local/share/tubcal/app)
      --no-sudo        never ask for root: user-space installs only
      --update         re-sync, rebuild and restart with the saved choices
                       (what `tubcal update` runs after pulling)
      --add LIST       add rooms to an installed Tubcal (`tubcal add`)
      --remove LIST    take rooms out of it (`tubcal remove`)
      --list           the rooms, and which are installed (`tubcal rooms`)
      --phone          put Tubcal for Android on a phone connected over USB
                       (`tubcal phone`); it needs USB debugging on
      --apk FILE       with --phone: install this APK instead of the latest release
      --replace        with --phone: uninstall a Tubcal signed with another key
                       first (this deletes its data on the phone)
      --uninstall      remove the launcher, menu entry, service and private tools
      --purge          with --uninstall: also delete a cloned app and its data
      --no-anim        skip the tuning-in animation
      --no-color       plain output (NO_COLOR is honoured too)
  -h, --help           this

Rooms (a room you leave out isn't downloaded)
  edition     The Edition: a daily paper from the rooms you follow
  hackernews  The Wire: Hacker News (also: wire, hn)
  topics      By topic: the Wire sorted into five topics by Ollama, shown with
              3D objects (also: bytopic, sorter; needs hackernews)
  reddit      The Dispatch: Reddit (also: dispatch)
  editor      The Composing Room: a code editor with a terminal
  dev         The Workbench: one manual per programming language (also: workbench)
  github      GitHub: repos, releases, your inbox
  youtube     The Screening Room: YouTube (also: screening)
  anime       The Anime: anime and your AniList list
  archive     The Archive: local transcription (~300 MB; needs youtube)

Options
  desktop    an app-menu entry and icon
  autostart  start the server when you log in
  extras     distro packages the rooms use: notify-send (live-stream pings),
             ripgrep (the editor's search)
  3d         3D objects: the home screen is a box you turn, with the TV on the
             front and a channel on each other side, and By topic sorts Hacker
             News into five topics with the local AI (Settings changes it later)

Environment
  TUBCAL_REPO, TUBCAL_BRANCH   what to clone (default: GitHub, main)
  TUBCAL_HOME                  installer-owned files (default ~/.local/share/tubcal)
  TUBCAL_BIN_DIR               where `tubcal` goes (default ~/.local/bin)
  TUBCAL_SYSTEMD=0             manage the server without systemd --user
  TUBCAL_PHONE_URL             where --phone downloads from (default: the latest
                               GitHub release of TUBCAL_REPO)
  ANDROID_SERIAL               the phone to use, when several are connected
EOF
}

parse_args() {
  local c
  while (($#)); do
    case $1 in
      -y|--yes) YES=1 ;;
      --with|--without)
        # checked against the rooms once the manifest is read (apply_force)
        [[ $# -ge 2 ]] || { echo "$1 needs a list" >&2; exit 2; }
        local IFS=,
        for c in $2; do
          [[ -n $c ]] || continue
          [[ $1 == --with ]] && FORCE[$c]=1 || FORCE[$c]=0
        done
        shift ;;
      --rooms|--modules) [[ $# -ge 2 ]] || { echo "$1 needs a list" >&2; exit 2; }; EXACT=${2//,/ }; [[ -n $EXACT ]] || EXACT=" "; shift ;;
      --add|--remove)
        [[ $# -ge 2 ]] || { echo "$1 needs a list of rooms" >&2; exit 2; }
        MODE=change
        local IFS=,
        for c in $2; do [[ $1 == --add ]] && CHANGE_ADD+=("$c") || CHANGE_REMOVE+=("$c"); done
        shift ;;
      --with=*|--without=*|--rooms=*|--modules=*|--add=*|--remove=*) set -- "${1%%=*}" "${1#*=}" "${@:2}"; continue ;;
      --list) MODE=list ;;
      --phone) MODE=phone ;;
      --apk) [[ $# -ge 2 ]] || { echo "--apk needs a file" >&2; exit 2; }; APK_FILE=$2; shift ;;
      --apk=*) APK_FILE=${1#*=} ;;
      --replace) REPLACE=1 ;;
      --dir) [[ $# -ge 2 ]] || { echo "--dir needs a path" >&2; exit 2; }; CLONE_DIR=$2; shift ;;
      --dir=*) CLONE_DIR=${1#*=} ;;
      --no-sudo) NO_SUDO=1 ;;
      --update) MODE=update; YES=1 ;;
      --uninstall) MODE=uninstall ;;
      --purge) PURGE=1 ;;
      --no-anim) ANIM=0 ;;
      --no-color) NOCOLOR_FLAG=1 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
  done
}

# ── terminal ─────────────────────────────────────────────────────────────────

TTY=0 COLOR=0 TRUECOLOR=0 UTF=0 CAN_ASK=0 W=72 STTY_SAVED="" CLR="" EL="" CUR=0
_LV=(0 95 135 175 215 255)

ui_init() {
  [[ -t 1 ]] && TTY=1
  COLOR=$TTY
  [[ -n ${NO_COLOR:-} || ${TERM:-dumb} == dumb ]] && COLOR=0
  ((NOCOLOR_FLAG)) && COLOR=0
  [[ ${COLORTERM:-} == truecolor || ${COLORTERM:-} == 24bit ]] && TRUECOLOR=1
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) UTF=1 ;; esac
  if ((TTY && !YES)) && (: </dev/tty) 2>/dev/null; then
    CAN_ASK=1
    STTY_SAVED=$(stty -g </dev/tty 2>/dev/null || true)
  fi
  local cols=80 rows
  if ((TTY)); then
    read -r rows cols < <(stty size </dev/tty 2>/dev/null) || cols=80
    [[ $cols =~ ^[0-9]+$ ]] || cols=80
  fi
  W=$((cols < 76 ? cols - 4 : 72))
  ((W < 40)) && W=40
  ((TTY)) || ANIM=0
  if ((TTY)); then CLR=$'\r\e[K' EL=$'\e[K'; else CLR="" EL=""; fi
  [[ -n ${TUBCAL_NO_ANIM:-} ]] && ANIM=0
  palette
}

# _esc 38|48 R G B → REPLY: a truecolor escape, or the nearest xterm-256 cube colour.
_esc() {
  if ((!COLOR)); then REPLY=""; return; fi
  if ((TRUECOLOR)); then REPLY=$'\e['"$1;2;$2;$3;$4m"; return; fi
  local v i d bd best idx=()
  for v in "$2" "$3" "$4"; do
    best=0 bd=999
    for i in 0 1 2 3 4 5; do
      d=$((v - _LV[i])); ((d < 0)) && d=$((-d))
      ((d < bd)) && { bd=$d; best=$i; }
    done
    idx+=("$best")
  done
  REPLY=$'\e['"$1;5;$((16 + 36 * idx[0] + 6 * idx[1] + idx[2]))m"
}

# The app's own tokens (frontend/src/styles/tokens.css): amber phosphor on
# kurocha wood, a persimmon pop, matcha for done. Body text keeps the
# terminal's own colour so light and dark terminals both read well.
palette() {
  local light=0
  case ${COLORFGBG:-} in *';7'|*';15') light=1 ;; esac
  if ((light)); then _esc 38 176 106 38; else _esc 38 230 171 94; fi; AMBER=$REPLY
  _esc 38 200 100 60; KAKI=$REPLY
  if ((light)); then _esc 38 98 120 48; else _esc 38 154 174 100; fi; GOOD=$REPLY
  _esc 38 199 90 68; BAD=$REPLY
  if ((COLOR)); then BOLD=$'\e[1m' DIM=$'\e[2m' RST=$'\e[0m'; else BOLD="" DIM="" RST=""; fi
  if ((UTF)); then
    G_OK="✓" G_BAD="✗" G_WARN="!" G_ON="●" G_OFF="○" G_PTR="▸" H="─" SEP="·"
  else
    G_OK="+" G_BAD="x" G_WARN="!" G_ON="[x]" G_OFF="[ ]" G_PTR=">" H="-" SEP="-"
  fi
}

rep() { local s; printf -v s '%*s' "$2" ''; REPLY=${s// /$1}; } # rep CHAR N → REPLY
vlen() { # vlen STRING → REPLY: its width on screen, colour escapes not counted
  # A plain loop: an extglob ${s//…/} backtracks into seconds on long rows.
  local s=$1 out=""
  while [[ $s == *$'\e['* ]]; do out+=${s%%$'\e['*}; s=${s#*$'\e['}; s=${s#*m}; done
  REPLY=$((${#out} + ${#s}))
}
say() { printf '  %s\n' "$*"; }
note() { printf '     %s%s%s\n' "$DIM" "$*" "$RST"; }
warn() { printf '  %s%s%s %s\n' "$AMBER" "$G_WARN" "$RST" "$*"; WARNINGS+=("$*"); }
die() {
  printf '\n  %s%s%s %s\n' "$BAD" "$G_BAD" "$RST" "$1"
  [[ -n ${2:-} ]] && printf '    %s\n' "${@:2}"
  printf '\n'
  exit 1
}

rule() {
  local t=$1; rep "$H" $((W - ${#t} - 4))
  printf '\n  %s%s%s %s%s%s %s%s%s\n' "$DIM" "$H$H" "$RST" "$BOLD$AMBER" "$t" "$RST" "$DIM" "$REPLY" "$RST"
}
kv() { # kv KEY VALUE: the value word-wraps under its own column
  local line="" word len=0 max=$((W - 14)) words
  read -ra words <<<"$2" # split without globbing
  printf '     %s%-10s%s ' "$DIM" "$1" "$RST"
  for word in "${words[@]}"; do
    vlen "$word"
    if ((len && len + 1 + REPLY > max)); then
      printf '%s\n%16s' "$line" ''
      line="" len=0
    fi
    line+="${line:+ }$word" len=$((len + (len ? 1 : 0) + REPLY))
  done
  printf '%s%s\n' "$line" "$RST"
}

tilde() { # tilde PATH [MAX] → REPLY: ~ for $HOME, and the middle elided past MAX columns
  local p=$1 max=${2:-0}
  [[ $p == "$HOME"* ]] && p="~${p#"$HOME"}"
  ((max > 0 && max < 24)) && max=24
  ((max > 0 && ${#p} > max)) && p="${p:0:10}…${p: -$((max - 11))}"
  REPLY=$p
}

hide_cursor() { ((TTY)) && printf '\e[?25l'; }
show_cursor() { ((TTY)) && printf '\e[?25h'; }

# ── the set: logo + test card ────────────────────────────────────────────────

LOGO_W=48
WM1="▀█▀ █ █ █▄▄ █▀▀ ▄▀█ █  "
WM2=" █  █▄█ █▄█ █▄▄ █▀█ █▄▄"
BARS=("232 217 184" "211 162 74" "143 174 155" "154 174 100" "154 142 199" "196 80 58" "103 120 156")
CASTLE=(6 -1 4 -1 2 -1 0) # the strip under the bars: SMPTE's reversed castellations

# A row inside the screen: ink background, padded to the panel's width.
_screen_row() { # _screen_row TEXT-WITH-FG-ESCAPES
  vlen "$1"
  printf '  %s%s%s%*s%s\n' "$INK_BG" "$1" "$INK_BG" $((LOGO_W - REPLY)) '' "$RST"
}

_static_rows() {
  local r c s chars=(' ' ' ' '░' '▒' '▓' '·' '▀' '▄') greys=("$FAINT_FG" "$DIMP_FG" "$INK3_FG")
  for r in 1 2 3 4 5 6; do
    s=""
    for ((c = 0; c < LOGO_W; c++)); do s+="${greys[RANDOM % 3]}${chars[RANDOM % 8]}"; done
    _screen_row "$s"
  done
}

_picture_rows() {
  local i s1="   " s2="   " r g b
  # A left-to-right glow across the wordmark: bright amber into persimmon.
  for i in 0 1 2 3 4 5; do
    r=$((242 - i * 6)) g=$((194 - i * 15)) b=$((122 - i * 10))
    _esc 38 $r $g $b
    s1+="$REPLY${WM1:i*4:4}"
    s2+="$REPLY${WM2:i*4:4}"
  done
  rep ' ' $((LOGO_W - 7))
  _screen_row "$REPLY${OSD_FG}CH 01"
  _screen_row "$BOLD$s1"
  _screen_row "$BOLD$s2$RST$INK_BG ${KAKI_FG}▄"
  _screen_row ""
  _screen_row "   ${PAPER_FG}a private broadcast station ${DIMP_FG}for one person"
  _screen_row ""
}

_bars() {
  local i w s="" t=""
  for i in 0 1 2 3 4 5 6; do
    w=$((LOGO_W * (i + 1) / 7 - LOGO_W * i / 7))
    _esc 38 ${BARS[i]}; s+=$REPLY; rep "█" "$w"; s+=$REPLY
    if ((CASTLE[i] < 0)); then t+=$INK_FG; else _esc 38 ${BARS[CASTLE[i]]}; t+=$REPLY; fi
    rep "▀" "$w"; t+=$REPLY
  done
  printf '  %s%s\n  %s%s\n' "$s" "$RST" "$t" "$RST"
}

logo() {
  if ((!COLOR || !UTF)); then
    printf '\n  %sT U B C A L .%s\n  %sa private broadcast station for one person%s\n' "$BOLD$AMBER" "$RST" "$DIM" "$RST"
    return
  fi
  _esc 48 28 20 13; INK_BG=$REPLY
  _esc 38 28 20 13; INK_FG=$REPLY
  _esc 38 48 33 20; INK3_FG=$REPLY
  _esc 38 232 217 184; PAPER_FG=$REPLY
  _esc 38 183 160 124; DIMP_FG=$REPLY
  _esc 38 137 112 83; FAINT_FG=$REPLY
  _esc 38 200 100 60; KAKI_FG=$REPLY
  _esc 38 154 174 100; OSD_FG=$REPLY
  rep "▄" $((LOGO_W - 2))
  printf '\n   %s%s%s\n' "$INK_FG" "$REPLY" "$RST"
  if ((ANIM)); then
    local f
    hide_cursor
    for f in 1 2 3 4 5; do
      _static_rows
      printf '\e[6A'
      sleep 0.06
    done
  fi
  _picture_rows
  _bars
  show_cursor
}

OS_ID="" OS_LIKE="" OS_NAME=""
ARCH="" PAGE=4096 MUSL=0 ASAHI=0 IMMUTABLE=0 FAMILY=none PRIV=none SYSTEMD=0 PKG_TOOL="" PKG_BIN=""
SUDO=()

detect_system() {
  local k v
  if [[ -r /etc/os-release ]]; then
    while IFS='=' read -r k v; do
      v=${v%\"} v=${v#\"} v=${v%\'} v=${v#\'}
      case $k in
        ID) OS_ID=$v ;; ID_LIKE) OS_LIKE=$v ;; PRETTY_NAME) OS_NAME=$v ;;
      esac
    done </etc/os-release
  fi
  [[ -n $OS_NAME ]] || OS_NAME="Linux"
  ARCH=$(uname -m)
  PAGE=$(getconf PAGESIZE 2>/dev/null || echo 4096)
  if ldd --version 2>&1 | grep -qi musl || compgen -G '/lib/ld-musl-*' >/dev/null; then MUSL=1; fi
  [[ "$OS_ID $OS_NAME $(uname -r)" == *[Aa]sahi* ]] && ASAHI=1
  [[ -e /run/ostree-booted ]] && IMMUTABLE=1

  # RHEL-family ids first: RHEL itself says ID_LIKE="fedora".
  case $OS_ID in
    rhel|centos|rocky|almalinux|ol|circle|eurolinux) FAMILY=el ;;
    *)
      case " $OS_ID $OS_LIKE " in
        *" nixos "*) FAMILY=nix ;;
        *fedora*) FAMILY=fedora ;;
        *" rhel "*|*" centos "*) FAMILY=el ;;
        *" debian "*|*" ubuntu "*) FAMILY=apt ;;
        *" arch "*|*" archarm "*|*" artix "*) FAMILY=pacman ;;
        *suse*) FAMILY=zypper ;;
        *" alpine "*|*" postmarketos "*) FAMILY=apk ;;
        *" void "*) FAMILY=xbps ;;
        *" gentoo "*) FAMILY=gentoo ;;
      esac ;;
  esac
  local tool
  case $FAMILY in
    fedora|el) tool=dnf ;; apt) tool=apt-get ;; pacman) tool=pacman ;; zypper) tool=zypper ;;
    apk) tool=apk ;; xbps) tool=xbps-install ;; *) tool="" ;;
  esac
  PKG_TOOL=$tool PKG_BIN=""
  # By absolute path: apk lives in /sbin, which a normal user's PATH often lacks.
  if [[ -n $tool ]]; then
    PKG_BIN=$(command -v "$tool" 2>/dev/null) ||
      for PKG_BIN in /usr/sbin/"$tool" /sbin/"$tool" ""; do [[ -x $PKG_BIN ]] && break; done
  fi
  CAN_PKG=0
  if [[ -n $PKG_BIN ]] && ((!IMMUTABLE)); then CAN_PKG=1; fi

  if ((EUID == 0)); then PRIV=root SUDO=()
  elif command -v sudo >/dev/null; then PRIV=sudo SUDO=(sudo)
  elif command -v doas >/dev/null; then PRIV=doas SUDO=(doas)
  else PRIV=none
  fi
  ((NO_SUDO)) && [[ $PRIV != root ]] && PRIV=none
  [[ $PRIV == none ]] && CAN_PKG=0

  SYSTEMD=0
  if [[ ${TUBCAL_SYSTEMD:-1} != 0 ]] && command -v systemctl >/dev/null &&
    timeout 5 systemctl --user show-environment >/dev/null 2>&1; then
    SYSTEMD=1
  fi
}

# What a tool is called in each family's repos. Empty = not packaged (or not
# worth taking from there) — the user-space path covers it instead.
pkgname() {
  case $FAMILY:$1 in
    fedora:git|el:git|zypper:git) echo git-core ;;
    *:git) echo git ;;
    *:curl) echo curl ;;
    *:tar) echo tar ;;
    apt:certs) echo ca-certificates ;;
    fedora:node|pacman:node|apk:node|xbps:node) echo nodejs ;;
    zypper:node) [[ $OS_ID == *tumbleweed* || $OS_ID == *slowroll* ]] && echo nodejs-default ;;
    fedora:npm|pacman:npm|apk:npm) echo npm ;;
    zypper:npm) [[ $OS_ID == *tumbleweed* || $OS_ID == *slowroll* ]] && echo npm-default ;;
    fedora:uv|pacman:uv|apk:uv|xbps:uv) echo uv ;;
    fedora:python) echo python3.13 ;;
    apt:notify) echo libnotify-bin ;;
    zypper:notify) echo libnotify-tools ;;
    *:notify) echo libnotify ;;
    *:ripgrep) echo ripgrep ;;
    apt:adb) echo adb ;; # its udev rules come along (android-sdk-platform-tools-common)
    pacman:adb) echo android-tools android-udev ;;
    fedora:adb|zypper:adb|apk:adb|xbps:adb) echo android-tools ;;
    pacman:udev) echo android-udev ;;
    apt:udev) echo android-sdk-platform-tools-common ;;
  esac
  return 0
}

# ── tools ────────────────────────────────────────────────────────────────────

ver_ge() { # ver_ge A B: is version A ≥ B (numeric dotted parts)
  local IFS=. i a b
  read -ra a <<<"${1%%[!0-9.]*}"; read -ra b <<<"$2"
  for i in 0 1 2; do
    ((${a[i]:-0} > ${b[i]:-0})) && return 0
    ((${a[i]:-0} < ${b[i]:-0})) && return 1
  done
  return 0
}

UV="" UV_VER="" NODE_BIN="" NODE_VER="" NPM_BIN=""

find_uv() {
  local c v
  for c in "$(command -v uv 2>/dev/null)" "$TUBCAL_HOME/bin/uv" "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
    [[ -n $c && -x $c ]] || continue
    v=$("$c" --version 2>/dev/null) || continue
    v=${v#uv } v=${v%% *}
    if ver_ge "$v" "$UV_MIN"; then UV=$c UV_VER=$v; return 0; fi
  done
  return 1
}

find_node() {
  local c v npm
  for c in "$(command -v node 2>/dev/null)" "$TUBCAL_HOME/node/bin/node"; do
    [[ -n $c && -x $c ]] || continue
    v=$("$c" --version 2>/dev/null) || continue
    v=${v#v}
    ver_ge "$v" "$NODE_MIN" || continue
    npm="$(dirname "$c")/npm"
    [[ -x $npm ]] || npm=$(command -v npm 2>/dev/null) || continue
    NODE_BIN=$c NODE_VER=$v NPM_BIN=$npm
    return 0
  done
  return 1
}

has() { command -v "$1" >/dev/null 2>&1; }

where() { # where PATH → REPLY: "private" for Tubcal's own copy, else a short path
  if [[ $1 == "$TUBCAL_HOME"/* ]]; then REPLY="private"; else tilde "$1" 30; fi
}

# ── where the app lives ──────────────────────────────────────────────────────

APP_DIR="" CLONED=0

is_tubcal_dir() { [[ -f $1/main.py && -d $1/server && -f $1/pyproject.toml ]] && grep -q '^name = "tubcal"' "$1/pyproject.toml"; }

locate_app() {
  local here=""
  if [[ -n ${BASH_SOURCE[0]:-} && -f ${BASH_SOURCE[0]} ]]; then
    here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
  fi
  if [[ -z $CLONE_DIR && -n $here ]] && is_tubcal_dir "$here"; then
    APP_DIR=$here CLONED=0
  else
    APP_DIR=${CLONE_DIR:-$TUBCAL_HOME/app} CLONED=1
    [[ $APP_DIR == /* ]] || APP_DIR="$PWD/$APP_DIR"
  fi
}

# ── rooms ────────────────────────────────────────────────────────────────────
#
# The rooms an install can leave out (modules.ini at the repo root), each with
# the files, Python packages, private tools and distro packages that are its
# alone. Piped from curl there's no checkout to read yet, so until there is one
# the menu reads embedded_manifest (at the end of this file): modules.ini
# without the paths. tests/test_modules.py keeps the two equal.

declare -A MAN=() # "<id>.<key>" → value; list values are space-separated
MOD_IDS=()        # the rooms, in the manifest's order
MANIFEST_FROM=""

read_manifest() { # read_manifest FILE
  local line sec="" key="" val
  local skip='^[[:space:]]*([#;]|$)' head='^\[([A-Za-z0-9_-]+)\][[:space:]]*$'
  local more='^[[:space:]]+([^[:space:]].*)$' pair='^([a-z_]+)[[:space:]]*=[[:space:]]*(.*)$'
  MAN=() MOD_IDS=()
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ $line =~ $skip ]] && continue
    if [[ $line =~ $head ]]; then sec=${BASH_REMATCH[1]} key=""; continue; fi
    [[ -n $sec ]] || continue
    if [[ $line =~ $more ]]; then # the next line of a value
      [[ -n $key ]] && MAN[$sec.$key]+="${MAN[$sec.$key]:+ }${BASH_REMATCH[1]}"
      continue
    fi
    [[ $line =~ $pair ]] || continue
    key=${BASH_REMATCH[1]} val=${BASH_REMATCH[2]}
    MAN[$sec.$key]=${val%%+([[:space:]])}
    [[ $key == name ]] && MOD_IDS+=("$sec")
  done <"$1"
  ((${#MOD_IDS[@]}))
}

load_manifest() {
  if [[ -r $APP_DIR/modules.ini ]] && read_manifest "$APP_DIR/modules.ini"; then
    MANIFEST_FROM=checkout
  else
    read_manifest <(embedded_manifest)
    MANIFEST_FROM=embedded
  fi
}

module_id() { # module_id WORD → REPLY: the room it names (its id, an alias or its name)
  local w=${1,,} id a name
  w=${w#the } w=${w// /}
  for id in "${MOD_IDS[@]}"; do
    name=${MAN[$id.name],,} name=${name#the } name=${name// /}
    if [[ $w == "$id" || $w == "$name" ]]; then REPLY=$id; return 0; fi
    for a in ${MAN[$id.aliases]:-}; do [[ $w == "$a" ]] && { REPLY=$id; return 0; }; done
  done
  return 1
}

bad_room() {
  echo "unknown room: $1" >&2
  echo "rooms: ${MOD_IDS[*]}  (\`tubcal rooms\` lists them)" >&2
  exit 2
}

# What a room needs comes with it, and goes when it goes.
mod_on() { local n; ON[$1]=1; for n in ${MAN[$1.needs]:-}; do ((ON[$n])) || mod_on "$n"; done; }
mod_off() {
  local m; ON[$1]=0
  for m in "${MOD_IDS[@]}"; do
    ((ON[$m])) && [[ " ${MAN[$m.needs]:-} " == *" $1 "* ]] && mod_off "$m"
  done
  return 0
}
rooms_on() { # → REPLY: the chosen rooms' ids, space-separated; false when none
  local id out=()
  for id in "${MOD_IDS[@]}"; do ((ON[$id])) && out+=("$id"); done
  REPLY="${out[*]}"
  ((${#out[@]}))
}
room_names() { # room_names ID… → REPLY: "The Wire, The Anime"
  local id out=""
  for id in "$@"; do out+="${out:+, }${MAN[$id.name]:-$id}"; done
  REPLY=$out
}
room_list() { # room_list KEY → REPLY: the KEY values (extras, groups, tools, packages) of the chosen rooms
  local id v out=" "
  for id in "${MOD_IDS[@]}"; do
    ((ON[$id])) || continue
    for v in ${MAN[$id.$1]:-}; do [[ $out == *" $v "* ]] || out+="$v "; done
  done
  out=${out# } REPLY=${out% }
}
wants_tool() { room_list tools; [[ " $REPLY " == *" $1 "* ]]; }

OPTS=(desktop autostart extras 3d)
PREV_CLONED=""
declare -A ON=() LOCKED=()
PREV_LOADED=0
PREV_PKGS=""
PREV_ROOMS="" # what the install record says is installed now (for --add / --remove)

load_previous() {
  [[ -r $CONF ]] || return 0
  local here=$APP_DIR id
  local EDITOR_X="" ARCHIVE="" DESKTOP="" AUTOSTART="" EXTRAS="" OBJECTS_3D="" APP_DIR="" CLONED=0
  local MODULES="" KNOWN_MODULES="" HAS_ROOMS=0
  local UV="" NODE_BIN="" BIN_DIR="" SYSTEMD="" PKGS_ADDED="" INSTALLED_AT=""
  # shellcheck source=/dev/null
  . "$CONF" 2>/dev/null || return 0
  PREV_LOADED=1 PREV_PKGS=$PKGS_ADDED
  # Re-running from inside a clone the installer made: still that clone.
  [[ $APP_DIR == "$here" ]] && PREV_CLONED=$CLONED
  grep -q '^MODULES=' "$CONF" && HAS_ROOMS=1
  for id in "${MOD_IDS[@]}"; do
    if ((HAS_ROOMS)); then
      if [[ " $MODULES " == *" $id "* ]]; then ON[$id]=1
      elif [[ " $KNOWN_MODULES " == *" $id "* ]]; then ON[$id]=0
      fi # a room newer than the record: its default (default_choices)
    else
      ON[$id]=1 # a record from before rooms could be left out: it had them all,
    fi
  done
  ((HAS_ROOMS)) || { [[ -n $ARCHIVE ]] && ON[archive]=$ARCHIVE; } # but The Archive was a choice
  [[ -n $DESKTOP ]] && ON[desktop]=$DESKTOP
  [[ -n $AUTOSTART ]] && ON[autostart]=$AUTOSTART
  [[ -n $EXTRAS ]] && ON[extras]=$EXTRAS
  [[ -n $OBJECTS_3D ]] && ON[3d]=$OBJECTS_3D
  rooms_on; PREV_ROOMS=$REPLY
  return 0
}

default_choices() {
  local id
  for id in "${MOD_IDS[@]}" "${OPTS[@]}"; do LOCKED[$id]=0; done
  for id in "${MOD_IDS[@]}"; do
    [[ -n ${ON[$id]:-} ]] && continue
    case $id in
      archive) # on by default only where it's already set up
        ON[archive]=0
        compgen -G "$APP_DIR/.venv/lib/python*/site-packages/faster_whisper" >/dev/null && ON[archive]=1 ;;
      # As in Settings → Rooms, where it starts switched off. A checkout you made
      # yourself already holds every room, so there it starts on, like the rest.
      github) ON[github]=$((CLONED ? 0 : 1)) ;;
      *) ON[$id]=1 ;;
    esac
  done
  : "${ON[desktop]:=1}"
  : "${ON[autostart]:=0}"
  : "${ON[extras]:=$CAN_PKG}"
  : "${ON[3d]:=0}"
  apply_force
  for id in "${MOD_IDS[@]}"; do ((ON[$id])) && mod_on "$id"; done
  extras_lock
}

apply_force() { # --rooms, --with and --without
  local w
  if [[ -n $EXACT ]]; then
    for w in "${MOD_IDS[@]}"; do ON[$w]=0; done
    for w in $EXACT; do module_id "$w" || bad_room "$w"; mod_on "$REPLY"; done
  fi
  for w in "${!FORCE[@]}"; do
    case $w in
      desktop|autostart|extras|3d) ON[$w]=${FORCE[$w]} ;;
      *)
        module_id "$w" || bad_room "$w"
        if ((FORCE[$w])); then mod_on "$REPLY"; else mod_off "$REPLY"; fi ;;
    esac
  done
}

pkg_bin() { case $1 in notify) REPLY=notify-send ;; ripgrep) REPLY=rg ;; *) REPLY=$1 ;; esac; }

# "extras" are the distro packages the chosen rooms use. Nothing to offer when
# none of those rooms is chosen, or when there's no package manager to use and
# they aren't here already.
extras_lock() {
  local p missing=0
  LOCKED[extras]=0
  room_list packages
  if [[ -z $REPLY ]]; then LOCKED[extras]=1; return; fi
  for p in $REPLY; do pkg_bin "$p"; has "$REPLY" || missing=1; done
  if ((!CAN_PKG && missing)); then ON[extras]=0 LOCKED[extras]=1; fi
}

declare -A LABEL=(
  [desktop]="App-menu entry & icon"
  [autostart]="Start when I log in"
  [extras]="Distro extras for the rooms"
  [3d]="3D objects"
)
declare -A DESC=(
  [desktop]="Launch Tubcal from your app menu like any other app."
  [autostart]="The server waits in the background, so the app opens at once."
  [3d]="Home becomes a box you turn: the TV in front, a channel on each other side. The Wire gets By topic, sorted by the local AI."
)

extras_desc() { # → REPLY: what the extras would bring, for the rooms chosen
  local out=() p
  room_list packages
  for p in $REPLY; do
    case $p in
      notify) out+=("notify-send pings you before a followed stream goes live") ;;
      ripgrep) out+=("ripgrep speeds up the editor's search") ;;
    esac
  done
  if ((${#out[@]} == 0)); then REPLY="Nothing to add for the rooms you picked."
  else local IFS=';'; REPLY="${out[*]}"; REPLY="${REPLY//;/; }."; REPLY="${REPLY^}"; fi
}

side_note() { # side_note ROW → REPLY: the menu's right-hand column
  case $1 in
    desktop|3d) REPLY="" ;;
    autostart) ((SYSTEMD)) && REPLY="systemd --user" || REPLY="XDG autostart" ;;
    extras)
      if ((LOCKED[extras] == 1)); then
        room_list packages
        [[ -n $REPLY ]] && REPLY="needs distro packages" || REPLY="none needed"
      else
        local p out=()
        room_list packages
        for p in $REPLY; do pkg_bin "$p"; out+=("$REPLY"); done
        local IFS=,; REPLY="${out[*]}"; REPLY=${REPLY//,/, }
      fi ;;
    *) REPLY=${MAN[$1.size]:-} ;;
  esac
}

menu_rows() { # → ROWS: "h:TITLE" headers, room ids and options, in menu order
  local ch id
  ROWS=()
  for ch in social coding video; do
    ROWS+=("h:${ch^^}")
    for id in "${MOD_IDS[@]}"; do [[ ${MAN[$id.channel]} == "$ch" ]] && ROWS+=("$id"); done
  done
  ROWS+=("h:ON THIS MACHINE" "${OPTS[@]}")
}

row_label() { if [[ -n ${LABEL[$1]:-} ]]; then REPLY=${LABEL[$1]}; else REPLY=${MAN[$1.name]}; fi; }

row_desc() { # row_desc ROW → REPLY: the line under the menu for the row the cursor is on
  case $1 in
    extras) extras_desc ;;
    desktop|autostart|3d) REPLY=${DESC[$1]} ;;
    *)
      local about=${MAN[$1.about]:-}
      if [[ -n ${MAN[$1.needs]:-} ]]; then room_names ${MAN[$1.needs]}; about+=" Comes with $REPLY."; fi
      REPLY=$about ;;
  esac
}

wrap2() { # wrap2 TEXT WIDTH → R1 R2: the text on two lines at most
  local words w l1="" l2="" over=0
  read -ra words <<<"$1"
  for w in "${words[@]}"; do
    if ((!over)) && ((${#l1} + ${#w} + 1 <= $2)); then l1+="${l1:+ }$w"
    else over=1
      if ((${#l2} + ${#w} + 1 <= $2)); then l2+="${l2:+ }$w"; else l2="${l2:0:$2-1}…"; break; fi
    fi
  done
  R1=$l1 R2=$l2
}

_menu_draw() {
  local i row box lab ptr side pad on
  for i in "${!ROWS[@]}"; do
    row=${ROWS[i]}
    if [[ $row == h:* ]]; then
      printf '\r\e[K     %s%s%s\n' "$DIM" "${row#h:}" "$RST"
      continue
    fi
    on=${ON[$row]:-0}
    if ((on)); then box="$GOOD$G_ON$RST"; else box="$DIM$G_OFF$RST"; fi
    ((LOCKED[$row] == 1)) && box="$DIM$( ((on)) && printf %s "$G_ON" || printf %s "$G_OFF")$RST"
    row_label "$row"
    if ((i == CUR)); then ptr="$AMBER$G_PTR$RST" lab="$BOLD$REPLY$RST"; else ptr=" " lab=$REPLY; fi
    local raw=$REPLY
    side_note "$row"; side=$REPLY
    pad=$((W - 9 - ${#raw} - ${#side}))
    ((pad < 1)) && pad=1
    printf '\r\e[K   %s %s  %s%*s%s%s%s\n' "$ptr" "$box" "$lab" "$pad" '' "$DIM" "$side" "$RST"
  done
  if [[ -n ${MSG:-} ]]; then R1=$MSG R2=""; else row_desc "${ROWS[CUR]}"; wrap2 "$REPLY" $((W - 6)); fi
  printf '\r\e[K\n\r\e[K     %s%s%s\n\r\e[K     %s%s%s\n' "$DIM" "$R1" "$RST" "$DIM" "$R2" "$RST"
  printf '\r\e[K     %s↑↓ move   space toggle   a all rooms   enter continue   q quit%s\n' "$DIM" "$RST"
}

_menu_static() {
  local id on=() off=() also=()
  for id in "${MOD_IDS[@]}"; do
    if ((ON[$id])); then on+=("$id"); else off+=("$id"); fi
  done
  for id in "${OPTS[@]}"; do ((ON[$id])) && also+=("${LABEL[$id],}"); done
  room_names "${on[@]}"; kv "Rooms" "$REPLY"
  if ((${#off[@]})); then room_names "${off[@]}"; kv "Left out" "$REPLY"; fi
  if ((${#also[@]})); then local IFS=';'; REPLY="${also[*]}"; kv "Also" "${REPLY//;/, }"; fi
}

_menu_step() { # _menu_step +1|-1: the next row that isn't a heading
  local n=${#ROWS[@]} i=$CUR
  while :; do
    i=$(((i + $1 + n) % n))
    [[ ${ROWS[i]} != h:* ]] && break
  done
  CUR=$i
}

_menu_toggle() {
  local row=$1 before after
  ((LOCKED[$row] == 1)) && return
  case $row in
    desktop|autostart|extras|3d) ON[$row]=$((1 - ON[$row])) ;;
    *)
      rooms_on; before=$REPLY
      if ((ON[$row])); then mod_off "$row"; else mod_on "$row"; fi
      rooms_on; after=$REPLY
      # say what came or went with it
      local id moved=()
      for id in "${MOD_IDS[@]}"; do
        [[ $id == "$row" ]] && continue
        if [[ " $before " == *" $id "* && " $after " != *" $id "* ]] || [[ " $before " != *" $id "* && " $after " == *" $id "* ]]; then
          moved+=("$id")
        fi
      done
      if ((${#moved[@]})); then
        room_names "${moved[@]}"
        if ((ON[$row])); then MSG="$REPLY comes with it."; else MSG="$REPLY goes with it: it needs ${MAN[$row.name]}."; fi
      fi
      extras_lock ;;
  esac
}

_menu_all() { # a: every room on, or (when they all are) every room off
  local id all=1
  for id in "${MOD_IDS[@]}"; do ((ON[$id])) || all=0; done
  for id in "${MOD_IDS[@]}"; do ON[$id]=$((1 - all)); done
  extras_lock
}

choose_components() {
  rule "PROGRAMME"
  menu_rows
  if ((!CAN_ASK)); then
    _menu_static
    ((YES)) || note "No terminal to ask on, so these are the defaults (--rooms, --with and --without change them)."
    return
  fi
  note "Pick the rooms to install. One you leave out isn't downloaded."
  printf '\n'
  CUR=0 MSG=""
  _menu_step 1
  local n=$((${#ROWS[@]} + 4))
  hide_cursor
  _menu_draw
  while :; do
    read_key
    MSG=""
    case $KEY in
      up) _menu_step -1 ;;
      down) _menu_step 1 ;;
      space) _menu_toggle "${ROWS[CUR]}" ;;
      all) _menu_all ;;
      enter) rooms_on && break; MSG="Pick at least one room." ;;
      quit) show_cursor; printf '\n'; say "Off air. Nothing was installed."; exit 0 ;;
    esac
    printf '\e[%dA' "$n"
    _menu_draw
  done
  # Fold the menu into the plain list of what was chosen.
  printf '\e[%dA\e[J' $((n + 2))
  _menu_static
  show_cursor
}

read_key() {
  local k rest=""
  KEY=other
  IFS= read -rsn1 k </dev/tty || { KEY=enter; return; }
  case $k in
    $'\e')
      IFS= read -rsn2 -t 0.05 rest </dev/tty || true
      case $rest in '[A'|'OA') KEY=up ;; '[B'|'OB') KEY=down ;; *) KEY=other ;; esac ;;
    '') KEY=enter ;;
    ' '|x|X) KEY=space ;;
    a|A) KEY=all ;;
    k|K) KEY=up ;;
    j|J) KEY=down ;;
    q|Q) KEY=quit ;;
  esac
}

# ask "Question" Y|N → 0 for yes. Without a terminal, the default wins.
ask() {
  local q=$1 def=$2 hint key
  [[ $def == Y ]] && hint="Y/n" || hint="y/N"
  if ((!CAN_ASK)); then [[ $def == Y ]]; return; fi
  printf '\n  %s?%s %s %s[%s]%s ' "$AMBER" "$RST" "$q" "$DIM" "$hint" "$RST"
  while :; do
    IFS= read -rsn1 key </dev/tty || key=""
    case $key in
      y|Y) printf 'yes\n'; return 0 ;;
      n|N) printf 'no\n'; return 1 ;;
      '') if [[ $def == Y ]]; then printf 'yes\n'; return 0; else printf 'no\n'; return 1; fi ;;
      q|Q|$'\e') printf 'no\n'; return 1 ;;
    esac
  done
}

# ── running steps ────────────────────────────────────────────────────────────

STEP_N=0 CUR_PID="" WARNINGS=()
NOTE_FILE="" LOG=""

t_now() { local t=${EPOCHREALTIME:-$SECONDS.000000}; t=${t//[.,]/}; REPLY=$((10#$t / 1000)); } # ms
fmt_ms() {
  local ms=$1
  if ((ms < 10000)); then REPLY="$((ms / 1000)).$((ms % 1000 / 100))s"
  elif ((ms < 60000)); then REPLY="$((ms / 1000))s"
  else REPLY="$((ms / 60000))m $((ms % 60000 / 1000))s"; fi
}

step_line() { # step_line SYMBOL LABEL RIGHT: a one-column symbol; RIGHT may carry colour
  local right=$3 label=$2 pad rlen
  vlen "$right"; rlen=$REPLY
  local max=$((W - 11 - rlen))
  ((max < 8)) && max=8 # a narrow terminal and a long note
  ((${#label} > max)) && label="${label:0:max-1}…"
  pad=$((W - 9 - ${#label} - rlen))
  ((pad < 1)) && pad=1
  printf '%s   %s%02d%s  %s  %s%*s%s%s%s' "$CLR" "$DIM" "$STEP_N" "$RST" "$1" "$label" "$pad" '' "$DIM" "$right" "$RST"
}

step_done() { # step_done LABEL NOTE: something already in place
  STEP_N=$((STEP_N + 1))
  step_line "$GOOD$G_OK$RST" "$1" "${2:-}"
  printf '\n'
}

_LEVELS=(▁ ▂ ▃ ▄ ▅ ▆ ▇)
_BRAILLE=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
_meter() { # a four-bar level meter, like the needles on a mixing desk
  local i
  REPLY=""
  for i in 0 1 2 3; do REPLY+=${_LEVELS[RANDOM % 7]}; done
}

_last_line() {
  local l
  l=$(tail -c 600 "$1" 2>/dev/null | tr '\r' '\n' | grep -v '^[[:space:]]*$' | tail -n 1 | tr -d '\033') || l=""
  l=${l//$'\t'/ }
  l=${l##+( )}
  local max=$((W - 12))
  ((${#l} > max)) && l="${l:0:max-1}…"
  REPLY=$l
}

note_out() { [[ -n ${NOTE_FILE:-} ]] && printf '%s' "$*" >"$NOTE_FILE"; } # a step's right-hand note

# run [--soft] LABEL FUNC [ARGS…]: FUNC runs in the background with its output
# in the log; a level meter and the latest output line show it's alive.
# --soft: a failure is a warning (amber, one line) rather than a stop.
run() {
  local soft=0
  [[ $1 == --soft ]] && { soft=1; shift; }
  local label=$1; shift
  local slog t0 pid rc i=0 tailtxt="" spin
  STEP_N=$((STEP_N + 1))
  slog=$(mktemp "${TMPDIR:-/tmp}/tubcal-step.XXXXXX")
  : >"$NOTE_FILE"
  t_now; t0=$REPLY
  printf '\n=== %02d %s (%s)\n' "$STEP_N" "$label" "$(date '+%H:%M:%S')" >>"$LOG"
  ("$@") >"$slog" 2>&1 </dev/null &
  pid=$! CUR_PID=$!
  if ((TTY)); then
    hide_cursor
    while kill -0 "$pid" 2>/dev/null; do
      ((i % 3 == 0)) && { _last_line "$slog"; tailtxt=$REPLY; }
      t_now; fmt_ms $((REPLY - t0)); local took=$REPLY
      if ((UTF)); then
        spin="$AMBER${_BRAILLE[i % 10]}$RST"
        _meter; took="$RST$AMBER$REPLY$RST$DIM $took"
      else
        spin="$AMBER${_SPIN[i % 4]}$RST"
      fi
      step_line "$spin" "$label" "$took"
      printf '\n\r\e[K          %s%s%s\e[1A\r' "$DIM" "$tailtxt" "$RST"
      sleep 0.1
      i=$((i + 1))
    done
  else
    printf '   %02d  %s …\n' "$STEP_N" "$label"
  fi
  wait "$pid"; rc=$?
  CUR_PID=""
  cat "$slog" >>"$LOG"
  t_now; fmt_ms $((REPLY - t0))
  local took=$REPLY note
  note=$(<"$NOTE_FILE")
  local right=$took
  [[ -n $note ]] && right="$note $SEP $took"
  if ((rc == 0)); then
    step_line "$GOOD$G_OK$RST" "$label" "$right"
    printf '\n%s' "$EL"
  elif ((soft)); then
    _last_line "$slog"
    step_line "$AMBER$G_WARN$RST" "$label" "$took"
    printf '\n%s' "$EL"
    [[ -n $REPLY ]] && printf '          %s%s%s\n' "$DIM" "$REPLY" "$RST"
  else
    step_line "$BAD$G_BAD$RST" "$label" "$took"
    printf '\n%s' "$EL"
    _show_tail "$slog"
  fi
  show_cursor
  rm -f "$slog"
  return $rc
}
_SPIN=('|' '/' '-' '\')

_show_tail() {
  local l bar="│" top="┌" bot="└"
  ((UTF)) || { bar="|" top="+" bot="+"; }
  printf '          %s%s last lines of the log%s\n' "$DIM" "$top" "$RST"
  while IFS= read -r l; do
    l=${l//$'\e'/}
    ((${#l} > W - 10)) && l="${l:0:W-11}…"
    printf '          %s%s%s %s\n' "$DIM" "$bar" "$RST" "$l"
  done < <(tr '\r' '\n' <"$1" | grep -v '^[[:space:]]*$' | tail -n 14)
  tilde "$LOG"
  printf '          %s%s full log: %s%s\n' "$DIM" "$bot" "$REPLY" "$RST"
}

kill_tree() {
  local p=$1 c f
  for f in /proc/"$p"/task/*/children; do
    [[ -r $f ]] || continue
    for c in $(<"$f"); do kill_tree "$c"; done
  done
  kill -TERM "$p" 2>/dev/null
}

cleanup() {
  [[ -n ${CUR_PID:-} ]] && kill_tree "$CUR_PID"
  show_cursor
  [[ -n $STTY_SAVED ]] && stty "$STTY_SAVED" </dev/tty 2>/dev/null
  [[ -n ${NOTE_FILE:-} ]] && rm -f "$NOTE_FILE" "$NOTE_FILE.why"
  # adb's server, if this run started it (the phone step), goes again
  ((${ADB_STARTED:-0})) && "$ADB" kill-server >/dev/null 2>&1
  return 0
}
on_interrupt() {
  printf '\n\n  %s%s%s Interrupted. Run the installer again to pick up where it stopped.\n\n' "$AMBER" "$G_WARN" "$RST"
  exit 130
}

# ── the steps ────────────────────────────────────────────────────────────────

PKGS=() PKGS_ADDED="" WARN_FILE=""

want() { local p; p=$(pkgname "$1"); [[ -n $p ]] && PKGS+=("$p"); return 0; }

plan_packages() {
  local p
  PKGS=()
  has git || want git
  has curl || want curl
  has tar || want tar
  [[ $FAMILY == apt && ! -e /etc/ssl/certs/ca-certificates.crt ]] && want certs
  if ! find_node; then want node; want npm; fi
  find_uv || want uv
  # Fedora's own Python 3.13 (on Asahi, a native aarch64 build), unless uv
  # already has one; elsewhere uv brings its own.
  if [[ $FAMILY == fedora ]] && ! has python3.13 &&
    ! { find_uv && "$UV" python find 3.13 >/dev/null 2>&1; }; then
    want python
  fi
  if ((ON[extras])); then
    room_list packages
    for p in $REPLY; do pkg_bin "$p"; has "$REPLY" || want "$p"; done
  fi
  ((CAN_PKG)) || PKGS=()
  return 0
}

# Without distro packages, some basics have to be here already. Say so before
# anything runs rather than halfway through.
preflight() {
  local need=() t
  if ((!CAN_PKG)) || [[ $MODE == update ]]; then
    { find_uv && find_node; } || need+=(curl)
    find_node || need+=(tar)
    ((CLONED)) && [[ ! -d $APP_DIR/.git ]] && need+=(git)
    for t in "${need[@]}"; do has "$t" || MISSING+=("$t"); done
    ((MUSL)) && ! find_node && MISSING+=("Node.js $NODE_MIN+ (nodejs.org has no musl build)")
  fi
  ((${#MISSING[@]} == 0)) || die "Missing ${MISSING[*]}, and there's no way to install it from here." \
    "Install it with your package manager, then run this again."
}
MISSING=()

planned() { local p; p=$(pkgname "$1"); [[ -n $p && " ${PKGS[*]} " == *" $p "* ]]; }

pkg_count() { note_out "${#PKGS[@]} package$( ((${#PKGS[@]} == 1)) || echo s)"; }

pkg_cmd_text() {
  local s=""
  [[ $PRIV != root ]] && s="${SUDO[*]} "
  case $FAMILY in
    fedora|el) REPLY="${s}dnf install ${PKGS[*]}" ;;
    apt) REPLY="${s}apt-get install ${PKGS[*]}" ;;
    pacman) REPLY="${s}pacman -S --needed ${PKGS[*]}" ;;
    zypper) REPLY="${s}zypper install ${PKGS[*]}" ;;
    apk) REPLY="${s}apk add ${PKGS[*]}" ;;
    xbps) REPLY="${s}xbps-install -S ${PKGS[*]}" ;;
  esac
}

_priv() { if [[ $PRIV == sudo ]]; then sudo -n "$@"; elif [[ $PRIV == doas ]]; then doas "$@"; else "$@"; fi; }

# pkg_step LABEL: PKGS from the distro, as one step (sudo asked for once).
pkg_step() {
  if [[ $PRIV == sudo ]] && ! sudo -n true 2>/dev/null; then
    printf '\n'
    note "sudo, once, for: ${PKGS[*]}"
    sudo -v </dev/tty || { printf '\n'; return 1; }
    printf '\n'
  fi
  if [[ $PRIV == doas ]]; then
    # doas can't lend a password to a background job, so this one runs in the open.
    STEP_N=$((STEP_N + 1))
    note "doas for: ${PKGS[*]}"
    install_packages </dev/tty || return 1
  else
    run --soft "$1" install_packages || return 1
  fi
  PKGS_ADDED="${PKGS_ADDED:+$PKGS_ADDED }${PKGS[*]}"
}

install_packages() {
  local p failed=()
  pkg_count
  case $FAMILY in
    fedora|el)
      local skip=(--setopt=strict=0)
      "$PKG_BIN" --version 2>/dev/null | grep -q 'dnf5' && skip=(--skip-unavailable)
      _priv "$PKG_BIN" install -y --setopt=install_weak_deps=False "${skip[@]}" "${PKGS[@]}" ;;
    apt)
      _priv env DEBIAN_FRONTEND=noninteractive "$PKG_BIN" update -q &&
        _priv env DEBIAN_FRONTEND=noninteractive "$PKG_BIN" install -y -q --no-install-recommends "${PKGS[@]}" ;;
    pacman) _priv "$PKG_BIN" -S --needed --noconfirm "${PKGS[@]}" ;;
    zypper) _priv "$PKG_BIN" --non-interactive --ignore-unknown install --no-recommends "${PKGS[@]}" ;;
    apk | xbps)
      # No skip-unavailable here: try them together, then one by one.
      local cmd=("$PKG_BIN" add --no-cache)
      [[ $FAMILY == xbps ]] && cmd=("$PKG_BIN" -Sy)
      if ! _priv "${cmd[@]}" "${PKGS[@]}"; then
        for p in "${PKGS[@]}"; do _priv "${cmd[@]}" "$p" || failed+=("$p"); done
        ((${#failed[@]})) && echo "not installed: ${failed[*]}"
      fi
      return 0 ;;
  esac
}

fetch_source() {
  if [[ -d $APP_DIR/.git ]]; then
    git -C "$APP_DIR" pull --ff-only
  else
    if [[ -e $APP_DIR ]] && [[ -n $(ls -A "$APP_DIR" 2>/dev/null) ]]; then
      echo "$APP_DIR exists and isn't a Tubcal checkout"
      return 1
    fi
    mkdir -p "$(dirname "$APP_DIR")"
    # Commits and folders now; a file's contents only once it's checked out, and
    # nothing is until the rooms are chosen (apply_rooms), so a room left out
    # never comes down at all.
    if ! git clone --filter=blob:none --no-checkout --depth 1 --branch "$TUBCAL_BRANCH" "$TUBCAL_REPO" "$APP_DIR"; then
      rm -rf "$APP_DIR"
      echo "the server refused a partial clone; cloning in full"
      git clone --no-checkout --depth 1 --branch "$TUBCAL_BRANCH" "$TUBCAL_REPO" "$APP_DIR" || return 1
    fi
  fi
  note_out "$(git -C "$APP_DIR" rev-parse --short HEAD)"
}

# A clone made with --no-checkout has no modules.ini on disk yet: read the
# rooms' files from the commit itself. (Runs in this shell, not as a step: the
# steps run in subshells, and the manifest has to outlive them.)
reload_manifest() {
  local tmp id before=" ${MOD_IDS[*]} "
  if [[ -r $APP_DIR/modules.ini ]]; then
    read_manifest "$APP_DIR/modules.ini" || return 1
  else
    tmp=$(mktemp) && git -C "$APP_DIR" show HEAD:modules.ini >"$tmp" 2>/dev/null && read_manifest "$tmp" || { rm -f "$tmp"; return 1; }
    rm -f "$tmp"
  fi
  MANIFEST_FROM=checkout
  # a room this installer's own copy didn't know: its default
  for id in "${MOD_IDS[@]}"; do [[ $before == *" $id "* ]] || { [[ $id == archive ]] && ON[$id]=0 || ON[$id]=1; }; done
  return 0
}

# ── the rooms' files ─────────────────────────────────────────────────────────
#
# The checkout holds only the chosen rooms' files: every path a left-out room
# owns is excluded with git's sparse checkout (and in a clone made here, the
# parts a desktop install never uses: the Android app and the website). Adding a
# room back re-includes its paths, and git fetches what it doesn't have yet.

sparse_patterns() { # → stdout: non-cone patterns, everything but what's left out
  local id p
  echo "/*"
  for id in "${MOD_IDS[@]}"; do
    ((ON[$id])) && continue
    for p in ${MAN[$id.paths]:-}; do echo "!/$p"; done
  done
  if ((CLONED)); then for p in ${MAN[elsewhere.paths]:-}; do echo "!/$p"; done; fi
}

git_has_sparse() { # git sparse-checkout reapply: git 2.27
  local v
  v=$(git --version 2>/dev/null) || return 1
  v=${v#git version } v=${v%% *}
  ver_ge "$v" 2.27.0
}

apply_rooms() {
  cd "$APP_DIR" || return 1
  local pats file was fresh=0
  pats=$(sparse_patterns)
  file="$(git rev-parse --absolute-git-dir)/info/sparse-checkout" || return 1
  was=$(git config --bool core.sparseCheckout 2>/dev/null) || was=false
  [[ -z $(git ls-files | head -n 1) ]] && fresh=1 # a --no-checkout clone: nothing on disk yet

  if [[ $pats == "/*" && $was != true ]]; then
    ((fresh)) && { git read-tree -mu HEAD || return 1; }
    note_out "every room"
    return 0
  fi
  if ((!fresh)) && ! git_has_sparse; then
    echo "git $(git --version | cut -d' ' -f3) can't leave files out of an existing checkout (2.27+ can)"
    return 1
  fi
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$pats" >"$file"
  git config core.sparseCheckout true
  git config core.sparseCheckoutCone false
  if ((fresh)); then
    git read-tree -mu HEAD || return 1
  elif [[ $pats == "/*" ]]; then
    git sparse-checkout disable || return 1 # every room again: the whole checkout
  else
    # changes only what's on disk; files with local changes stay, with a warning
    git sparse-checkout reapply || return 1
  fi
  local out=0 id
  for id in "${MOD_IDS[@]}"; do ((ON[$id])) || out=$((out + 1)); done
  if ((out)); then note_out "$out room$( ((out == 1)) || echo s) left out"; else note_out "every room"; fi
}

install_uv() {
  has curl || { echo "curl is needed to fetch uv"; return 1; }
  mkdir -p "$TUBCAL_HOME/bin"
  curl -LsSf https://astral.sh/uv/install.sh |
    env UV_INSTALL_DIR="$TUBCAL_HOME/bin" UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 sh || return 1
  local v
  v=$("$TUBCAL_HOME/bin/uv" --version) || return 1
  v=${v#uv }
  note_out "${v%% *}"
}

install_node() {
  local arch
  case $ARCH in
    x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; armv7l) arch=armv7l ;;
    ppc64le) arch=ppc64le ;; s390x) arch=s390x ;;
    *) echo "nodejs.org has no Linux build for $ARCH; install Node.js $NODE_MIN+ from your distro"; return 1 ;;
  esac
  ((MUSL)) && { echo "nodejs.org has no musl build; install nodejs and npm from your distro"; return 1; }
  has curl && has tar || { echo "curl and tar are needed to fetch Node.js"; return 1; }
  local base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x" sums line sha file tmp
  sums=$(curl -fsSL --retry 3 "$base/SHASUMS256.txt") || return 1
  line=$(grep -E " node-v[0-9.]+-linux-${arch}\.tar\.gz$" <<<"$sums") || { echo "no linux-$arch build listed"; return 1; }
  sha=${line%% *} file=${line##* }
  tmp=$(mktemp -d)
  echo "downloading $file"
  curl -fL --retry 3 -sS -o "$tmp/$file" "$base/$file" || return 1
  echo "$sha  $tmp/$file" | sha256sum -c - || { echo "checksum mismatch for $file"; return 1; }
  rm -rf "$TUBCAL_HOME/node.new" && mkdir -p "$TUBCAL_HOME/node.new"
  tar -xzf "$tmp/$file" -C "$TUBCAL_HOME/node.new" --strip-components=1 || return 1
  rm -rf "$tmp"
  "$TUBCAL_HOME/node.new/bin/node" --version || { echo "the downloaded Node.js doesn't run here"; return 1; }
  rm -rf "$TUBCAL_HOME/node" && mv "$TUBCAL_HOME/node.new" "$TUBCAL_HOME/node"
  note_out "$("$TUBCAL_HOME/node/bin/node" --version) $SEP sha256 ok"
}

sync_backend() { # sync_backend [EXTRA…]: the chosen rooms' packages, without the EXTRAs named
  cd "$APP_DIR" || return 1
  local args=(sync --locked --no-progress --no-default-groups) x skip=" $* "
  [[ -x .venv/bin/pytest ]] && args+=(--group dev) # keep a developer's test deps
  room_list extras
  for x in $REPLY; do [[ $skip == *" $x "* ]] || args+=(--extra "$x"); done
  room_list groups
  for x in $REPLY; do args+=(--group "$x"); done
  NO_COLOR=1 "$UV" "${args[@]}" || return 1
  note_out "Python $(.venv/bin/python -c 'import platform; print(platform.python_version())')"
}

check_archive() {
  cd "$APP_DIR" && .venv/bin/python -c '
import importlib.metadata as m
import numpy, ctranslate2, faster_whisper  # noqa: F401
print("faster-whisper", m.version("faster-whisper"))' || return 1
  note_out "faster-whisper ready"
}

build_frontend() {
  cd "$APP_DIR/frontend" || return 1
  export PATH="$(dirname "$NODE_BIN"):$PATH" NO_COLOR=1 FORCE_COLOR=0
  export npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
  local sum
  sum=$(sha256sum package-lock.json | cut -d' ' -f1)
  if [[ ! -d node_modules || $(cat node_modules/.tubcal-lock 2>/dev/null) != "$sum" ]]; then
    "$NPM_BIN" ci --loglevel=error || return 1
    echo "$sum" >node_modules/.tubcal-lock
  fi
  # only the chosen rooms' pages (frontend/src/build/modules.mjs)
  rooms_on
  TUBCAL_MODULES=${REPLY// /,} "$NPM_BIN" run build || return 1
  [[ -f dist/index.html ]] || { echo "the build produced no dist/index.html"; return 1; }
  note_out "$(du -sh dist 2>/dev/null | cut -f1)"
}

install_ytdlp() {
  export UV_TOOL_DIR="$TUBCAL_HOME/tools" UV_TOOL_BIN_DIR="$TUBCAL_HOME/bin" NO_COLOR=1
  "$UV" tool install --upgrade --no-progress 'yt-dlp[default]' || return 1
  local site
  site=$("$UV_TOOL_DIR/yt-dlp/bin/python" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])') || return 1
  # yt-dlp reads a "portable" config beside its package. Tubcal's copy gets
  # Node as a JS runtime, so YouTube's challenges solve without Deno; your own
  # yt-dlp, if you have one, is left alone.
  {
    echo "# Written by Tubcal's installer, for Tubcal's private yt-dlp only."
    echo "--js-runtimes \"node:$NODE_BIN\""
  } >"$site/yt-dlp.conf"
  note_out "$("$UV_TOOL_BIN_DIR/yt-dlp" --version)"
}

remove_ytdlp() { # the Screening Room was removed: its yt-dlp goes too
  UV_TOOL_DIR="$TUBCAL_HOME/tools" UV_TOOL_BIN_DIR="$TUBCAL_HOME/bin" NO_COLOR=1 \
    "$UV" tool uninstall yt-dlp || rm -rf "$TUBCAL_HOME/tools/yt-dlp" "$TUBCAL_HOME/bin/yt-dlp"
  rm -f "$STATE_DIR/yt-dlp.checked"
}

render() { # render TEMPLATE → stdout, with @TOKENS@ filled
  local t
  t=$(<"$1")
  t=${t//@TUBCAL_HOME@/"$TUBCAL_HOME"}
  t=${t//@BIN@/"$BIN_DIR"}
  t=${t//@APP_DIR@/"$APP_DIR"}
  printf '%s\n' "$t"
}

write_conf() {
  mkdir -p "$TUBCAL_HOME"
  local MODULES KNOWN_MODULES="${MOD_IDS[*]}" DESKTOP=${ON[desktop]}
  local AUTOSTART=${ON[autostart]} EXTRAS=${ON[extras]} OBJECTS_3D=${ON[3d]} INSTALLED_AT k
  rooms_on; MODULES=$REPLY
  INSTALLED_AT=$(date '+%Y-%m-%d %H:%M')
  {
    echo "# Tubcal's install record: written by install.sh, read by \`tubcal\`."
    echo "# Re-run install.sh (or \`tubcal update\`, \`tubcal add\`) rather than editing this."
    echo "# MODULES: the rooms installed; KNOWN_MODULES: every room there was to pick."
    for k in APP_DIR CLONED UV NODE_BIN BIN_DIR MODULES KNOWN_MODULES DESKTOP AUTOSTART EXTRAS OBJECTS_3D SYSTEMD PKGS_ADDED INSTALLED_AT; do
      printf '%s=%q\n' "$k" "${!k}"
    done
  } >"$CONF.new" && mv "$CONF.new" "$CONF"
}

install_launcher() {
  local src="$APP_DIR/packaging/linux"
  mkdir -p "$BIN_DIR" "$STATE_DIR"
  write_conf
  render "$src/tubcal" >"$BIN_DIR/tubcal.new" && chmod 755 "$BIN_DIR/tubcal.new" &&
    mv "$BIN_DIR/tubcal.new" "$BIN_DIR/tubcal" || return 1
  if ((ON[desktop])); then
    mkdir -p "$APPS_DIR" "$ICON_DIR"
    cp "$APP_DIR/frontend/public/icon.svg" "$ICON_DIR/tubcal.svg"
    render "$src/tubcal.desktop" >"$APPS_DIR/tubcal.desktop"
    has update-desktop-database && update-desktop-database -q "$APPS_DIR" 2>/dev/null
    has gtk-update-icon-cache && gtk-update-icon-cache -q -t "$XDG_DATA/icons/hicolor" 2>/dev/null
  else
    rm -f "$APPS_DIR/tubcal.desktop" "$ICON_DIR/tubcal.svg"
  fi
  if ((SYSTEMD)); then
    mkdir -p "$UNIT_DIR"
    render "$src/tubcal.service" >"$UNIT_DIR/tubcal.service"
    systemctl --user daemon-reload
  fi
  "$BIN_DIR/tubcal" autostart "$( ((ON[autostart])) && echo on || echo off)" >/dev/null
  tilde "$BIN_DIR/tubcal"; note_out "$REPLY"
}

# Boot the app against a throwaway database and ask it for the page and its
# health; then try the imports that only load on first use (anime scrapers,
# fuzzy search), which is where an unusual platform would trip.
self_test() {
  cd "$APP_DIR" || return 1
  rooms_on
  TUBCAL_AUTO_UPDATE=0 TUBCAL_MODULES=${REPLY// /,} .venv/bin/python - "$WARN_FILE" "$REPLY" <<'PY' || return 1
import importlib, pathlib, shutil, sys, tempfile

from server import config

tmp = pathlib.Path(tempfile.mkdtemp(prefix="tubcal-selftest-"))
config.DATA_DIR, config.DB_PATH = tmp, tmp / "selftest.db"
try:
    from server import create_app, db

    db.init_db()
    client = create_app().test_client()
    health = client.get("/api/health")
    assert health.status_code == 200 and health.get_json()["ok"], health.data[:200]
    rooms, chosen = health.get_json()["data"].get("modules"), sys.argv[2].split()
    assert rooms == chosen, f"the server has rooms {rooms}, not the ones chosen ({chosen})"
    page = client.get("/")
    assert page.status_code == 200 and b'id="root"' in page.data, "the built frontend isn't being served"
finally:
    shutil.rmtree(tmp, ignore_errors=True)

late = {"rapidfuzz": "fuzzy search"}
if "anime" in sys.argv[2].split():
    late.update({"anipy_api.provider": "anime playback",
                 "curl_cffi": "the backup anime source", "lxml": "the backup anime source"})
with open(sys.argv[1], "w") as out:
    for mod, feature in late.items():
        try:
            importlib.import_module(mod)
        except Exception as exc:
            out.write(f"{feature} may not work: {mod} won't load ({type(exc).__name__}: {exc})\n"[:300])
print("ok")
PY
  if wants_tool yt-dlp; then "$TUBCAL_HOME/bin/yt-dlp" --version >/dev/null || { echo "yt-dlp doesn't run"; return 1; }; fi
  note_out "page + API answer"
}

# ── the phone ────────────────────────────────────────────────────────────────
#
# Tubcal for Android (android/) is published as a GitHub release of two files:
# the APK and tubcal-phone.txt, which gives its version, checksum, size, the
# oldest Android it runs on and the CPUs it's built for (android/tools/release.sh
# writes both). It goes on over adb, so the phone needs USB debugging on (or
# wireless debugging, paired and connected with adb first).

PHONE_PKG=com.tubcal.app
PHONE_CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/tubcal
ADB="" ADB_STARTED=0 WHY_FILE=""
P_SERIAL=() P_STATE=() P_NAME=() PI=-1 # what phone_scan found; PI: the one to use
PHONE="" PHONE_NAME="" PHONE_WANT=${ANDROID_SERIAL:-}
P_SDK="" P_ANDROID="" P_ABIS="" P_HAS="" P_HAS_CODE=""
declare -A REL=() # tubcal-phone.txt
PHONE_DONE="" PHONE_SEEN=0

find_adb() {
  local c
  for c in "$(command -v adb 2>/dev/null)" "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/nonexistent}}/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb"; do
    [[ -n $c && -x $c ]] && { ADB=$c; return 0; }
  done
  return 1
}
adbq() { if has timeout; then timeout 20 "$ADB" "$@"; else "$ADB" "$@"; fi; } # the quick questions
adb_running() { (exec 3<>"/dev/tcp/127.0.0.1/${ANDROID_ADB_SERVER_PORT:-5037}") 2>/dev/null; }
adb_start() { # adb's server, started if it isn't running (and stopped again on the way out)
  ((ADB_STARTED)) || adb_running && return 0
  adbq start-server >/dev/null 2>&1 && ADB_STARTED=1
}

# Phones on USB, read from sysfs, so without adb: "debug" when USB debugging is
# on (an interface of class ff/42/01, the one adb looks for), "files" when only
# file transfer (MTP) is. iPhones (Apple's vendor id) are passed over.
# → lines: KIND<TAB>SERIAL<TAB>NAME
usb_phones() {
  local d i kind
  for d in /sys/bus/usb/devices/*; do
    [[ -r $d/idVendor && $(<"$d/idVendor") != 05ac ]] || continue
    kind=""
    for i in "$d/${d##*/}":*; do
      [[ -r $i/bInterfaceClass ]] || continue
      if [[ $(<"$i/bInterfaceClass")$(<"$i/bInterfaceSubClass")$(<"$i/bInterfaceProtocol") == ff4201 ]]; then
        kind=debug
        break
      fi
      [[ $(cat "$i/interface" 2>/dev/null) == MTP ]] && kind=files
    done
    [[ -n $kind ]] && printf '%s\t%s\t%s\n' "$kind" "$(cat "$d/serial" 2>/dev/null)" "$(cat "$d/product" 2>/dev/null)"
  done
  return 0
}

# adb's view, USB and Wi-Fi: device, unauthorized, offline, no permissions, …
# → lines: STATE<TAB>SERIAL<TAB>NAME
adb_devices() {
  local line serial rest state name
  while IFS= read -r line; do
    [[ $line == List* || $line == '*'* || $line != *[[:space:]]* ]] && continue
    serial=${line%%[[:space:]]*} rest=${line#"$serial"} rest=${rest##+([[:space:]])}
    state=${rest%%[[:space:]]*} name=""
    [[ $state == no ]] && state="no permissions"
    [[ $rest =~ model:([^[:space:]]+) ]] && name=${BASH_REMATCH[1]//_/ }
    [[ $serial == emulator-* ]] && name="the emulator"
    printf '%s\t%s\t%s\n' "$state" "$serial" "$name"
  done < <(adbq devices -l 2>/dev/null)
}

phone_scan() { # → P_SERIAL / P_STATE / P_NAME
  P_SERIAL=() P_STATE=() P_NAME=()
  local usb kind serial name seen=" "
  local -A usbname=()
  usb=$(usb_phones)
  while IFS=$'\t' read -r kind serial name; do [[ -n $serial ]] && usbname[$serial]=$name; done <<<"$usb"
  # During an install, adb only when there's something for it to see: a phone
  # with USB debugging on, or an adb server already running (it may hold Wi-Fi
  # connections). Asked for a phone (--phone), always: an emulator or a phone
  # paired over Wi-Fi shows up only once adb's server is running.
  if find_adb && { [[ $MODE == phone || $'\n'$usb == *$'\n'debug$'\t'* ]] || adb_running; }; then
    adb_start
    while IFS=$'\t' read -r kind serial name; do
      [[ -n $serial ]] || continue
      P_SERIAL+=("$serial") P_STATE+=("$kind") P_NAME+=("${name:-${usbname[$serial]:-}}")
      seen+="$serial "
    done < <(adb_devices)
  fi
  while IFS=$'\t' read -r kind serial name; do
    [[ -n $kind ]] || continue
    [[ -n $serial && $seen == *" $serial "* ]] && continue
    if [[ $kind == files ]]; then kind="no debugging"
    elif [[ -n $ADB ]]; then kind=connecting # adb hasn't caught up with it yet
    else kind="no adb"; fi
    P_SERIAL+=("$serial") P_STATE+=("$kind") P_NAME+=("$name")
  done <<<"$usb"
}

# phone_pick → PI: ANDROID_SERIAL's phone, the one that's ready, or the one
# nearest to ready. False when there's none; 2 when you didn't choose one.
phone_pick() {
  local i r best=-1 ready=()
  PI=-1
  if [[ -n $PHONE_WANT ]]; then
    for i in "${!P_SERIAL[@]}"; do [[ ${P_SERIAL[i]} == "$PHONE_WANT" ]] && { PI=$i; return 0; }; done
    return 1
  fi
  for i in "${!P_SERIAL[@]}"; do [[ ${P_STATE[i]} == device ]] && ready+=("$i"); done
  if ((${#ready[@]} == 1)); then PI=${ready[0]}; return 0; fi
  ((${#ready[@]} > 1)) && { phone_choose "${ready[@]}"; return; }
  for i in "${!P_SERIAL[@]}"; do
    case ${P_STATE[i]} in
      unauthorized) r=5 ;; "no permissions") r=4 ;; connecting|offline|authorizing) r=3 ;;
      "no adb") r=2 ;; "no debugging") r=1 ;; *) r=0 ;;
    esac
    ((r > best)) && { best=$r; PI=$i; }
  done
  ((PI >= 0))
}

phone_choose() { # phone_choose INDEX…: several phones are ready; which one?
  local i k n=0 picks=("$@")
  if ((!CAN_ASK)); then
    say "Several phones are connected. Choose one with ANDROID_SERIAL=<serial>:"
    for i in "$@"; do note "${P_SERIAL[i]}  ${P_NAME[i]}"; done
    return 2
  fi
  printf '\n'
  say "Several phones are connected:"
  for i in "$@"; do n=$((n + 1)); printf '     %s%d%s  %s %s%s%s\n' "$AMBER" "$n" "$RST" "${P_NAME[i]:-a phone}" "$DIM" "${P_SERIAL[i]}" "$RST"; done
  printf '\n  %s?%s Which one? %s[1-%d]%s ' "$AMBER" "$RST" "$DIM" "$n" "$RST"
  while :; do
    IFS= read -rsn1 k </dev/tty || k=q
    if [[ $k == [1-9] ]] && ((k <= n)); then
      printf '%s\n' "$k"
      PI=${picks[k - 1]} PHONE_WANT=${P_SERIAL[PI]}
      return 0
    fi
    [[ $k == [qQnN] || $k == $'\e' ]] && { printf 'none\n'; return 2; }
  done
}

android_name() { # android_name SDK → REPLY: "8.0", "14", …
  case $1 in
    26) REPLY=8.0 ;; 27) REPLY=8.1 ;; 28) REPLY=9 ;; 29) REPLY=10 ;; 30) REPLY=11 ;; 31|32) REPLY=12 ;;
    *) if (($1 >= 33)); then REPLY=$(($1 - 20)); else REPLY="API $1"; fi ;;
  esac
}

# phone_why STATE NAME → REPLY: what to do about it, a line each
phone_why() {
  local n fix
  yours "${2:-the phone}"; n=$REPLY
  case $1 in
    none) REPLY="No phone found. Connect your Android phone with a USB cable.
USB debugging has to be on: on the phone, open Settings → About phone
and tap Build number seven times, then turn on USB debugging in
Settings → System → Developer options. (Over Wi-Fi: \`adb pair\` and
\`adb connect\` it first.)" ;;
    "no debugging") REPLY="${n^} is connected, but USB debugging is off. On the phone, open
Settings → About phone and tap Build number seven times, then turn on
USB debugging in Settings → System → Developer options." ;;
    unauthorized) REPLY="On ${n}, tap Allow when it asks \"Allow USB debugging?\". Tick
\"Always allow from this computer\" to skip the question next time.
No question on the phone? Unplug it and plug it back in." ;;
    "no permissions")
      fix=$(pkgname udev)
      if [[ -n $fix ]]; then fix="Install them (the $fix package), then unplug the phone and plug it back in."
      else fix="Install your distribution's udev rules for Android, then unplug the phone and plug it back in."; fi
      REPLY="This computer can see ${n} but isn't allowed to use it: the udev
rules for Android phones are missing.
$fix" ;;
    connecting|offline|authorizing) REPLY="${n^} isn't answering yet. If this lasts, unplug it and plug it back in." ;;
    *) REPLY="${n^} is in $1 mode. Start it up normally." ;;
  esac
  ((UTF)) || REPLY=${REPLY//→/>}
}

# phone_ready: wait for a phone with USB debugging allowed for this computer,
# saying what to do on the way. → PHONE, PHONE_NAME. False when you stop it
# (q), after five minutes, or at once when there's no terminal to wait on.
phone_ready() {
  local st name last="" t0=$SECONDS i=0 k l spin settling
  while :; do
    phone_scan
    phone_pick
    case $? in 0) st=${P_STATE[PI]} name=${P_NAME[PI]} ;; 2) return 1 ;; *) st=none name="" ;; esac
    ((i)) && printf '%s' "$CLR"
    case $st in
      device) PHONE=${P_SERIAL[PI]} PHONE_NAME=${name:-the phone}; return 0 ;;
      "no adb") phone_get_adb || return 1; continue ;;
    esac
    # A phone adb has only just seen (or a server only just started) takes a
    # moment to answer: no advice yet.
    settling=0
    if [[ $st == @(connecting|offline|authorizing) ]] || { [[ $st == none ]] && ((ADB_STARTED)); }; then
      ((SECONDS - t0 < 5)) && settling=1
    fi
    if [[ $st == none && -n $PHONE_WANT ]]; then REPLY="No phone $PHONE_WANT (ANDROID_SERIAL) is connected."
    else phone_why "$st" "$name"; fi
    if ((!settling)) && [[ $REPLY != "$last" ]]; then
      last=$REPLY
      printf '\n'
      while IFS= read -r l; do say "$l"; done <<<"$REPLY"
      printf '\n'
      if ((!CAN_ASK)); then
        say "Then run \`tubcal phone\` again."
        return 1
      fi
    fi
    if ((SECONDS - t0 > 300)); then
      say "Stopped waiting. Run \`tubcal phone\` when the phone is ready."
      return 1
    fi
    if ((!CAN_ASK)); then sleep 1; continue; fi
    if ((UTF)); then spin=${_BRAILLE[i % 10]}; else spin=${_SPIN[i % 4]}; fi
    printf '%s  %s%s%s waiting for the phone %s(q to stop)%s' "$CLR" "$AMBER" "$spin" "$RST" "$DIM" "$RST"
    i=$((i + 1))
    if IFS= read -rsn1 -t 1 k </dev/tty && [[ $k == [qQnN] || $k == $'\e' ]]; then
      printf '%s' "$CLR"
      say "Stopped. Run \`tubcal phone\` when the phone is ready."
      return 1
    fi
  done
}

# adb isn't installed: from the distro when there's a package and root, asked
# first; otherwise, where to get it.
phone_get_adb() {
  local pk
  pk=$(pkgname adb)
  printf '\n'
  say "Putting Tubcal on a phone needs adb, Android's debugging tool,"
  say "and it isn't installed."
  if ((CAN_PKG && CAN_ASK)) && [[ -n $pk ]]; then
    read -ra PKGS <<<"$pk"
    pkg_cmd_text
    if ask "Install it now? ($REPLY)" Y && pkg_step "adb (Android's debugging tool)" && find_adb; then
      record_pkgs
      return 0
    fi
  fi
  printf '\n'
  say "Install adb, then run \`tubcal phone\`:"
  if [[ -n $pk ]]; then pkg_cmd_text; note "$REPLY"
  else note "your distribution's adb or android-tools package"; fi
  note "or Google's platform tools: developer.android.com/tools/releases/platform-tools"
  return 1
}

record_pkgs() { # the install record keeps what came from the distro (uninstall lists it)
  [[ -w $CONF ]] || return 0
  local l
  while IFS= read -r l; do
    if [[ $l == PKGS_ADDED=* ]]; then printf 'PKGS_ADDED=%q\n' "$PKGS_ADDED"; else printf '%s\n' "$l"; fi
  done <"$CONF" >"$CONF.new" && mv "$CONF.new" "$CONF"
}

phone_base() { # → REPLY: where the release's files are
  if [[ -n ${TUBCAL_PHONE_URL:-} ]]; then REPLY=${TUBCAL_PHONE_URL%/}; return 0; fi
  local re='github\.com[:/]+([^/]+)/([^/]+)$' r=${TUBCAL_REPO%/}
  [[ $r =~ $re ]] || return 1
  REPLY="https://github.com/${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}/releases/latest/download"
}

# tubcal-phone.txt → REL[version code sha256 size min_sdk abis]. It's read
# line by line and checked, never sourced.
phone_release() {
  [[ -n ${REL[version]:-} ]] && return 0
  local txt k v ok
  local word='^[0-9A-Za-z.+_-]{1,40}$' num='^[0-9]{1,12}$' hex='^[0-9a-f]{64}$' abis='^[a-z0-9_ -]{1,80}$'
  phone_base || return 1
  txt=$(curl -fsSL --retry 2 --max-time 30 "$REPLY/tubcal-phone.txt" 2>/dev/null) || return 1
  while IFS='=' read -r k v; do
    v=${v%$'\r'} ok=0
    case $k in
      version) [[ $v =~ $word ]] && ok=1 ;;
      code|size|min_sdk) [[ $v =~ $num ]] && ok=1 ;;
      sha256) [[ $v =~ $hex ]] && ok=1 ;;
      abis) [[ $v =~ $abis ]] && ok=1 ;;
    esac
    ((ok)) && REL[$k]=$v
  done <<<"$txt"
  [[ -n ${REL[version]:-} && -n ${REL[code]:-} && -n ${REL[sha256]:-} ]] || { REL=(); return 1; }
}

phone_facts() { # → P_SDK P_ANDROID P_ABIS PHONE_NAME, and P_HAS / P_HAS_CODE when Tubcal is on it
  local out l model=""
  out=$(adbq -s "$PHONE" shell "getprop ro.build.version.sdk; getprop ro.build.version.release; getprop ro.product.cpu.abilist; getprop ro.product.model; pm path $PHONE_PKG >/dev/null 2>&1 && dumpsys package $PHONE_PKG | grep -m2 -E 'versionCode=|versionName='" 2>/dev/null) || [[ -n $out ]] || return 1
  out=${out//$'\r'/}
  { read -r P_SDK; read -r P_ANDROID; read -r P_ABIS; read -r model; } <<<"$out"
  [[ $P_SDK =~ ^[0-9]+$ ]] || return 1
  P_HAS="" P_HAS_CODE=""
  [[ $out =~ versionCode=([0-9]+) ]] && P_HAS_CODE=${BASH_REMATCH[1]}
  [[ $out =~ versionName=([^[:space:]]+) ]] && P_HAS=${BASH_REMATCH[1]}
  [[ -n $P_HAS_CODE && -z $P_HAS ]] && P_HAS="(build $P_HAS_CODE)"
  [[ -n $model && $PHONE != emulator-* ]] && PHONE_NAME=$model
  return 0
}

mb() { REPLY="$((($1 + 524288) / 1048576)) MB"; } # mb BYTES
yours() { if [[ $1 == "the "* ]]; then REPLY=$1; else REPLY="your $1"; fi; } # "your Pixel 9a", "the emulator"

phone_download() { # phone_download BASE FILE: the release's APK, checked against its sha256
  local f=$2 sum="${REL[sha256]}"
  mkdir -p "$PHONE_CACHE" || return 1
  if [[ -f $f ]] && echo "$sum  $f" | sha256sum -c - >/dev/null 2>&1; then
    note_out "already here $SEP sha256 ok"
    return 0
  fi
  rm -f "$PHONE_CACHE"/tubcal-phone-*.apk "$PHONE_CACHE"/tubcal-phone-*.part
  curl -fL --retry 3 --progress-bar -o "$f.part" "$1/tubcal-phone.apk" || return 1
  if ! echo "$sum  $f.part" | sha256sum -c - >/dev/null 2>&1; then
    rm -f "$f.part"
    echo "the download doesn't match its checksum; run this again"
    return 1
  fi
  mv "$f.part" "$f"
  mb "$(stat -c %s "$f" 2>/dev/null || wc -c <"$f")"
  note_out "$REPLY $SEP sha256 ok"
}

phone_push() { # phone_push APK: adb install, keeping the app's data (unless --replace)
  local out
  if ((REPLACE)) && [[ -n $P_HAS ]]; then
    "$ADB" -s "$PHONE" uninstall "$PHONE_PKG" || return 1
  fi
  # (some adb builds log their own internals to stderr: "I0000 … adb_install.cpp")
  out=$("$ADB" -s "$PHONE" install -r "$1" 2>&1 | grep -vE '^(I[0-9]{4} |WARNING: All log messages)' | tee /dev/stderr)
  if [[ $out == *Success* && $out != *Failure* ]]; then
    note_out "${REL[version]:-installed}"
    return 0
  fi
  phone_failure "$out" >"$WHY_FILE"
  return 1
}

phone_failure() { # phone_failure ADB-OUTPUT → stdout: what went wrong, in words
  local f
  case $1 in
    *UPDATE_INCOMPATIBLE*|*SHARED_USER_INCOMPATIBLE*|*"signatures do not match"*)
      echo "The Tubcal already on the phone was signed with a different key (a build"
      echo "of your own?), so it can't be updated in place. \`tubcal phone --replace\`"
      echo "uninstalls it first, which deletes Tubcal's data on the phone." ;;
    *VERSION_DOWNGRADE*) echo "The phone has a newer Tubcal than this one, so it was left as it is." ;;
    *INSUFFICIENT_STORAGE*) echo "There isn't enough free space on the phone." ;;
    *USER_RESTRICTED*|*INSTALL_FAILED_ABORTED*)
      echo "The phone refused the install: look for a question on its screen. On"
      echo "Xiaomi, Redmi and POCO phones, turn on Install via USB in Developer options." ;;
    *VERIFICATION_FAILURE*|*VERIFICATION_TIMEOUT*)
      echo "Play Protect stopped the install. Run this again and choose Install"
      echo "anyway on the phone when it asks." ;;
    *NO_MATCHING_ABIS*) echo "Tubcal for Android isn't built for this phone's processor." ;;
    *OLDER_SDK*|*DEPRECATED_SDK_VERSION*) echo "This phone's Android is too old for Tubcal." ;;
    *offline*|*"not found"*|*"no devices"*) echo "The phone disconnected. Connect it again and run \`tubcal phone\`." ;;
    *)
      f=$(grep -m1 -oE 'Failure \[[^]]*\]' <<<"$1") || f=$(grep -v '^[[:space:]]*$' <<<"$1" | tail -n 1)
      echo "adb couldn't install it: ${f:-no reason given}" ;;
  esac
}

# phone_put: Tubcal for Android on the phone phone_ready found: the latest
# release (or --apk FILE), unless it's already there.
phone_put() {
  local apk base label
  if ! phone_facts; then
    say "Couldn't read ${PHONE_NAME}'s details over adb."
    say "Unplug it, plug it back in and try again."
    return 1
  fi
  android_name "$P_SDK"; local android="Android ${P_ANDROID:-$REPLY}"
  yours "$PHONE_NAME"; local on=$REPLY # "your Pixel 9a"
  if [[ -n $APK_FILE ]]; then
    apk=$APK_FILE label="Installing $(basename "$APK_FILE") on $on"
  else
    if ! phone_release; then
      if phone_base; then base="$REPLY/tubcal-phone.txt"; else base="nowhere: TUBCAL_REPO isn't on GitHub (set TUBCAL_PHONE_URL)"; fi
      say "Couldn't get Tubcal for Android's release details from"
      note "$base"
      note "Check this computer's internet connection and try again."
      return 1
    fi
    phone_base; base=$REPLY
    if ((P_SDK < ${REL[min_sdk]:-26})); then
      android_name "${REL[min_sdk]:-26}"
      say "Tubcal for Android needs Android $REPLY or newer, and $on has $android."
      return 1
    fi
    if [[ -n ${REL[abis]:-} ]]; then
      local a fits=0
      for a in ${P_ABIS//,/ }; do [[ " ${REL[abis]} " == *" $a "* ]] && fits=1; done
      if ((!fits)); then
        say "Tubcal for Android is built for ${REL[abis]// / and } processors, and"
        say "$on has ${P_ABIS%%,*}."
        return 1
      fi
    fi
  fi
  if [[ $MODE == phone ]]; then
    kv "Phone" "$PHONE_NAME $SEP $android $SEP ${P_ABIS%%,*}"
    if [[ -n $P_HAS ]]; then kv "On it" "Tubcal $P_HAS"; else kv "On it" "no Tubcal yet"; fi
    if [[ -z $APK_FILE ]]; then mb "${REL[size]:-0}"; kv "Release" "Tubcal for Android ${REL[version]} $SEP $REPLY"; fi
    printf '\n'
  fi
  if [[ -z $APK_FILE && -n $P_HAS_CODE ]] && ((!REPLACE)); then
    if ((P_HAS_CODE == ${REL[code]})); then
      step_done "Tubcal for Android ${REL[version]}" "already on $on"
      return 0
    elif ((P_HAS_CODE > ${REL[code]})); then
      step_done "Tubcal for Android" "${on^} has a newer one ($P_HAS)"
      return 0
    fi
  fi
  if ((REPLACE)) && [[ -n $P_HAS ]]; then
    say "--replace uninstalls the Tubcal on $on first, and with it the"
    say "phone's Tubcal data: subscriptions, sign-ins, history and saved things."
    if ((CAN_ASK)) && ! ask "Replace it?" N; then return 1; fi
  fi
  if [[ -z $APK_FILE ]]; then
    apk="$PHONE_CACHE/tubcal-phone-${REL[version]}.apk"
    run "Downloading Tubcal for Android ${REL[version]}" phone_download "$base" "$apk" || {
      say "The download failed. Check this computer's internet connection and try again."
      return 1
    }
    label="Installing it on $on"
    [[ -n $P_HAS ]] && label="Updating Tubcal on $on (was $P_HAS)"
  fi
  ((REPLACE)) && [[ -n $P_HAS ]] && label="Replacing the Tubcal on $on"
  : >"$WHY_FILE"
  note "If the phone asks about installing Tubcal, allow it."
  if ! run --soft "$label" phone_push "$apk"; then
    local l
    while IFS= read -r l; do say "$l"; done <"$WHY_FILE"
    return 1
  fi
  # The copy downloaded is on the phone now; the next one is downloaded fresh.
  [[ -z $APK_FILE ]] && rm -f "$apk"
  return 0
}

# During an install: a phone that's plugged in is offered Tubcal for Android.
phone_offer() {
  [[ $MODE == install ]] || return 0
  local t
  for t in 1 2 3 4; do # adb's first look at a phone can lag by a second
    phone_scan
    [[ " ${P_STATE[*]} " == *" connecting "* ]] || break
    sleep 1
  done
  ((${#P_SERIAL[@]})) || return 0
  if ((!CAN_ASK)); then PHONE_SEEN=1; return 0; fi
  local q name=${P_NAME[0]:-} i ready=0
  ((${#P_SERIAL[@]} == 1)) || name=""
  for i in "${!P_STATE[@]}"; do [[ ${P_STATE[i]} == device ]] && ready=$((ready + 1)); done
  # One phone, ready, with Tubcal on it: ask only when there's a newer one.
  if ((${#P_SERIAL[@]} == 1 && ready == 1)); then
    PHONE=${P_SERIAL[0]} PHONE_NAME=${name:-the phone}
    if phone_facts && [[ -n $P_HAS_CODE ]]; then
      phone_release && ((${REL[code]} > P_HAS_CODE)) || return 0
      yours "$PHONE_NAME"
      q="${REPLY^} has Tubcal $P_HAS. Update it to ${REL[version]} too?"
    fi
  fi
  if [[ -z ${q:-} ]]; then
    if [[ $name == "the emulator" ]]; then q="The Android emulator is running."
    elif [[ -n $name ]]; then q="Your $name is plugged in."
    else q="A phone is plugged in."; fi
    q+=" Put Tubcal for Android on it too?"
  fi
  ask "$q" Y || return 0
  phone_ready && phone_put && PHONE_DONE=$PHONE_NAME
  return 0 # the phone never fails the install
}

do_phone() {
  detect_system
  [[ -r $CONF ]] && PKGS_ADDED=$(. "$CONF" >/dev/null 2>&1; printf '%s' "${PKGS_ADDED:-}")
  if [[ -n $APK_FILE ]]; then
    [[ -f $APK_FILE ]] || die "There's no file $APK_FILE."
    APK_FILE=$(cd "$(dirname "$APK_FILE")" && pwd -P)/$(basename "$APK_FILE")
  fi
  printf '\n  %sTubcal%s %s for Android %s\n' "$BOLD$AMBER" "$RST" "$DIM" "$RST"
  rule "THE PHONE"
  phone_ready || { printf '\n'; exit 1; }
  phone_put || { printf '\n'; exit 1; }
  if [[ -n $P_HAS_CODE && -z $APK_FILE ]] && ((P_HAS_CODE >= ${REL[code]:-0} && !REPLACE)); then printf '\n'; return; fi
  yours "$PHONE_NAME"
  printf '\n  %s%s%s Tubcal for Android%s is on %s. Open it from the app drawer.\n' "$GOOD" "$G_OK" "$RST" \
    "${REL[version]:+ ${REL[version]}}" "$REPLY"
  note "It keeps its own subscriptions and sign-ins, separate from this computer's."
  printf '\n'
}

# ── screens ──────────────────────────────────────────────────────────────────

test_card() {
  rule "TEST CARD"
  local sys="$OS_NAME $SEP $ARCH"
  ((PAGE != 4096)) && sys+=" $SEP $((PAGE / 1024))K pages"
  kv "System" "$sys"
  if ((ASAHI)); then
    kv "" "${AMBER}Apple Silicon${RST} $SEP Fedora's own aarch64 builds first"
  fi
  local pk
  if ((CAN_PKG)); then
    case $PRIV in root) pk="$PKG_TOOL, as root, for anything missing" ;; *) pk="$PKG_TOOL via $PRIV, only for anything missing" ;; esac
  elif ((IMMUTABLE)); then pk="image-based system: nothing layered, all in your home"
  elif [[ $FAMILY == nix ]]; then pk="NixOS: user-space only (prebuilt binaries may need nix-ld)"
  elif ((NO_SUDO)); then pk="--no-sudo: all in your home"
  elif [[ $PRIV == none && -n $PKG_TOOL ]]; then pk="no sudo here: all in your home"
  else pk="no supported package manager: all in your home"
  fi
  kv "Packages" "$pk"
  tilde "$APP_DIR" $((W - 16))
  kv "Install" "$REPLY"
  if ((CLONED)); then kv "" "${DIM}a fresh clone of $TUBCAL_BRANCH${RST}"
  else kv "" "${DIM}this checkout, set up in place${RST}"; fi
  if [[ -r $CONF ]] && ((PREV_LOADED)); then kv "" "${DIM}an earlier install was found; its choices are pre-selected${RST}"; fi
}

running_order() {
  rule "RUNNING ORDER"
  plan_packages
  local bits=()
  if ((${#PKGS[@]})); then pkg_cmd_text; kv "Distro" "$REPLY"; fi
  if find_uv; then bits+=("uv $UV_VER")
  elif planned uv; then bits+=("uv ${DIM}(distro)${RST}")
  else bits+=("uv ${DIM}(download)${RST}"); fi
  if find_node; then bits+=("Node $NODE_VER")
  elif planned node; then bits+=("Node ${DIM}(distro)${RST}")
  else bits+=("Node $NODE_MAJOR LTS ${DIM}(private download)${RST}"); fi
  bits+=("Python 3.13 via uv")
  local joined="" b
  for b in "${bits[@]}"; do joined+="${joined:+ $SEP }$b"; done
  kv "Tools" "$joined"
  files_plan
  local x="backend" bits2=()
  room_list extras; bits2+=($REPLY)
  room_list groups; bits2+=($REPLY)
  ((${#bits2[@]})) && x+=" + ${bits2[*]}"
  x+=" $SEP frontend"
  wants_tool yt-dlp && x+=" $SEP yt-dlp ${DIM}(private, refreshed daily)${RST}"
  kv "Build" "$x"
  tilde "$BIN_DIR"; local b=$REPLY
  local l="tubcal in $b"
  ((ON[desktop])) && l+=" $SEP app menu"
  ((ON[autostart])) && l+=" $SEP autostart"
  kv "Launcher" "$l"
  ((ON[3d])) && kv "Home" "3D objects: a box you turn, the TV in front"
  if ((ON[extras])) && ((!CAN_PKG)); then
    note "notify-send/ripgrep are only used if already installed."
  fi
}

# What happens to the files, in words: the clone is partial; your own checkout
# loses the left-out rooms' files only when it's a git checkout.
files_plan() {
  local id out=()
  for id in "${MOD_IDS[@]}"; do ((ON[$id])) || out+=("$id"); done
  if ((CLONED)); then
    kv "Files" "a partial clone with only these rooms' files"
  elif ((${#out[@]} == 0)); then
    kv "Files" "this checkout as it is"
  elif [[ -d $APP_DIR/.git ]]; then
    room_names "${out[@]}"
    kv "Files" "leaves $REPLY out of this checkout ${DIM}(git sparse-checkout; files you've changed stay)${RST}"
  else
    kv "Files" "left as they are ${DIM}(not a git checkout); the rooms left out aren't built or served${RST}"
  fi
}

on_air() {
  local port=5000 url
  if [[ -n ${TUBCAL_PORT:-} ]]; then port=$TUBCAL_PORT
  elif [[ -f $APP_DIR/.env ]]; then
    local p
    p=$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?TUBCAL_PORT[[:space:]]*=[[:space:]]*"?([0-9]+)"?.*/\2/p' "$APP_DIR/.env" | tail -n 1)
    [[ -n $p ]] && port=$p
  fi
  url="http://127.0.0.1:$port"
  local cmd="tubcal"
  [[ ":$PATH:" == *":$BIN_DIR:"* ]] || { tilde "$BIN_DIR/tubcal"; cmd=$REPLY; }
  local tl tr bl br v hz
  if ((UTF)); then tl="╭" tr="╮" bl="╰" br="╯" v="│" hz="─"; else tl="+" tr="+" bl="+" br="+" v="|" hz="-"; fi
  local inner=$((W - 4)) lines=() l cw=$((${#cmd} + 14))
  lines+=("")
  lines+=("$KAKI$G_ON$RST ${BOLD}ON AIR${RST}   Tubcal is installed.")
  if [[ -n $PHONE_DONE ]]; then
    l=$PHONE_DONE
    ((${#l} > 36)) && l="${l:0:35}…"
    yours "$l"
    lines+=("           It's on $REPLY too.")
  fi
  lines+=("")
  lines+=("$(printf '%-*s' "$cw" "$cmd")${DIM}start it and open the browser${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd stop")${DIM}stop the server${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd status")${DIM}what's on, where, which versions${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd update")${DIM}pull, rebuild, restart${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd add ROOM")${DIM}add a room you left out${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd phone")${DIM}put Tubcal on your Android phone${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd uninstall")${DIM}take it all down again${RST}")
  lines+=("")
  local tailline="$AMBER$url$RST"
  ((ON[desktop])) && tailline+="  ${DIM}$SEP also in your app menu${RST}"
  lines+=("$tailline")
  lines+=("")
  rep "$hz" "$inner"
  printf '\n  %s%s%s%s%s\n' "$AMBER" "$tl" "$REPLY" "$tr" "$RST"
  for l in "${lines[@]}"; do
    vlen "$l"
    printf '  %s%s%s  %s%*s%s%s%s\n' "$AMBER" "$v" "$RST" "$l" $((inner - 2 - REPLY)) '' "$AMBER" "$v" "$RST"
  done
  rep "$hz" "$inner"
  printf '  %s%s%s%s%s\n' "$AMBER" "$bl" "$REPLY" "$br" "$RST"

  local notes=()
  [[ ":$PATH:" == *":$BIN_DIR:"* ]] || { tilde "$BIN_DIR"; notes+=("$REPLY isn't on your PATH yet; add it to use plain \`tubcal\`."); }
  ((PHONE_SEEN)) && notes+=("A phone is plugged in: \`tubcal phone\` puts Tubcal for Android on it.")
  if ((ON[archive] || ON[edition] || ON[topics])) && ! has ollama; then
    local writers=()
    for l in edition topics archive; do ((ON[$l])) && writers+=("$l"); done
    room_names "${writers[@]}"
    ((${#writers[@]} > 1)) && REPLY="${REPLY%, *} and ${REPLY##*, }"
    notes+=("No Ollama yet: $REPLY $( ((${#writers[@]} == 1)) && echo needs || echo need) it (ollama.com).")
  fi
  if ((${#WARNINGS[@]} + ${#notes[@]})); then
    printf '\n'
    for l in "${WARNINGS[@]}"; do printf '  %s%s%s %s\n' "$AMBER" "$G_WARN" "$RST" "$l"; done
    for l in "${notes[@]}"; do note "$l"; done
  fi
  if ((CAN_ASK)) && ask "Tune in now?" Y; then
    "$BIN_DIR/tubcal" open
  fi
  printf '\n'
}

# ── modes ────────────────────────────────────────────────────────────────────

do_install() {
  if ((EUID == 0)) && [[ -n ${SUDO_USER:-} && $SUDO_USER != root ]]; then
    die "Run this as yourself, not with sudo." \
      "It asks for sudo on its own, and only to install distro packages."
  fi
  detect_system
  locate_app
  load_manifest
  load_previous
  [[ -n $PREV_CLONED ]] && CLONED=$PREV_CLONED
  PKGS_ADDED=$PREV_PKGS
  default_choices
  [[ $MODE == change ]] && apply_change
  if [[ $MODE == install ]]; then
    logo
    ((EUID == 0)) && warn "Running as root: Tubcal will be installed for root only."
    [[ $FAMILY == nix ]] && warn "NixOS isn't really supported: prebuilt Node/uv/Python need nix-ld or an FHS shell."
    test_card
    choose_components
    running_order
    preflight
    if ! ask "Roll tape?" Y; then printf '\n'; say "Off air. Nothing was installed."; printf '\n'; exit 0; fi
  else
    [[ -r $CONF ]] || die "No install record at $CONF." "Run install.sh first."
    [[ $MODE == update ]] && printf '\n  %sTubcal%s %s updating %s\n' "$BOLD$AMBER" "$RST" "$DIM" "$RST"
    plan_packages
    PKGS=() # an update never asks for root; missing tools take the user-space path
    preflight
  fi

  rule "ON THE FLOOR"
  if ((${#PKGS[@]})); then
    pkg_step "Distro packages" ||
      warn "Some distro packages didn't install; using user-space fallbacks where there are any."
  fi

  if ((CLONED)) && [[ $MODE != change ]]; then
    has git || die "git is needed to fetch Tubcal." "Install git, then run this again."
    run "Fetching Tubcal" fetch_source || die "Couldn't fetch $TUBCAL_REPO."
  fi
  if [[ -d $APP_DIR/.git ]]; then
    reload_manifest || die "$APP_DIR has no modules.ini." "Is it an older Tubcal? Run \`tubcal update\` first."
    if ((CLONED)); then
      run "The rooms' files" apply_rooms || die "Couldn't check out the rooms you picked."
    elif ! run --soft "The rooms' files" apply_rooms; then
      warn "The left-out rooms' files stay in this checkout; those rooms still aren't built or served."
    fi
  fi
  is_tubcal_dir "$APP_DIR" || die "$APP_DIR doesn't look like Tubcal."

  if find_uv; then
    where "$UV"; step_done "uv" "$UV_VER $SEP $REPLY"
  else
    run "uv (into Tubcal's own folder)" install_uv || die "Couldn't install uv." "See https://docs.astral.sh/uv/ to install it yourself, then run this again."
    find_uv || die "uv installed but doesn't run here."
  fi

  if find_node; then
    where "$NODE_BIN"; step_done "Node.js" "$NODE_VER $SEP $REPLY"
  else
    run "Node.js $NODE_MAJOR LTS (private)" install_node || die "Couldn't set up Node.js $NODE_MIN+." "Install nodejs and npm from your distro, then run this again."
    find_node || die "Node.js installed but doesn't run here."
  fi

  # The Archive's speech models and the Edition's numpy are the heavy, native
  # part: when they can't install here, the rest goes in without them.
  local synced=0
  if ((ON[archive])); then
    if run --soft "Python & backend, with The Archive" sync_backend &&
      run --soft "The Archive's speech models load" check_archive; then
      synced=1
    else
      warn "The Archive can't run on this machine, so it's left out (the rest is unaffected)."
      mod_off archive
      if [[ -d $APP_DIR/.git ]]; then run --soft "The rooms' files" apply_rooms || true; fi
    fi
  fi
  if ((!synced)); then
    room_list extras
    if [[ " $REPLY " == *" edition "* ]]; then
      if ! run --soft "Python & backend" sync_backend; then
        warn "numpy didn't install, so The Edition won't group stories by topic."
        run "Python & backend, without numpy" sync_backend edition || die "uv sync failed."
      fi
    else
      run "Python & backend" sync_backend || die "uv sync failed."
    fi
  fi

  run "Building the frontend" build_frontend || die "The frontend build failed."
  if wants_tool yt-dlp; then
    run "yt-dlp (private, self-updating)" install_ytdlp || die "Couldn't install yt-dlp."
  elif [[ -e $TUBCAL_HOME/bin/yt-dlp ]]; then
    run --soft "yt-dlp (the Screening Room's) removed" remove_ytdlp || true
  fi
  run "Launcher & app-menu entry" install_launcher || die "Couldn't install the launcher."
  : >"$WARN_FILE"
  run "Test transmission" self_test || die "The self-test failed." "Tubcal is installed but didn't answer correctly; the log above says why."
  local w
  while IFS= read -r w; do [[ -n $w ]] && WARNINGS+=("$w"); done <"$WARN_FILE"

  # A server the launcher started is still running the old code: restart it.
  # (One started by hand, say a dev server, is left alone.)
  "$BIN_DIR/tubcal" status --quiet
  if (($? == 0)); then
    run "Back on air" "$BIN_DIR/tubcal" restart || warn "Restart failed; try \`tubcal restart\`."
  fi
  if [[ $MODE == update ]]; then
    printf '\n  %s%s%s Updated.\n\n' "$GOOD" "$G_OK" "$RST"
    return
  fi
  if [[ $MODE == change ]]; then
    changed_done
    return
  fi
  phone_offer
  on_air
}

# ── tubcal add / remove / rooms ──────────────────────────────────────────────

CH_ADDED=() CH_REMOVED=()

# --add / --remove: change the record's rooms, with what each needs, and say so.
apply_change() {
  [[ -r $CONF ]] || die "No install record at $CONF." "Run install.sh first."
  local w id asked=" " before after implied=()
  for w in "${CHANGE_ADD[@]}"; do module_id "$w" || bad_room "$w"; mod_on "$REPLY"; asked+="$REPLY "; done
  for w in "${CHANGE_REMOVE[@]}"; do module_id "$w" || bad_room "$w"; mod_off "$REPLY"; asked+="$REPLY "; done
  before=" $PREV_ROOMS "
  rooms_on || die "That would leave no rooms at all." "Keep one, or take Tubcal off with \`tubcal uninstall\`."
  after=" $REPLY "
  for id in "${MOD_IDS[@]}"; do
    if [[ $before != *" $id "* && $after == *" $id "* ]]; then CH_ADDED+=("$id")
    elif [[ $before == *" $id "* && $after != *" $id "* ]]; then CH_REMOVED+=("$id")
    else continue; fi
    [[ $asked == *" $id "* ]] || implied+=("$id")
  done
  printf '\n'
  if ((${#CH_ADDED[@]} + ${#CH_REMOVED[@]} == 0)); then
    for w in "${CHANGE_ADD[@]}"; do module_id "$w"; room_names "$REPLY"; say "$REPLY is already installed."; done
    for w in "${CHANGE_REMOVE[@]}"; do module_id "$w"; room_names "$REPLY"; say "$REPLY isn't installed."; done
    printf '\n'
    exit 0
  fi
  if ((${#CH_ADDED[@]})); then room_names "${CH_ADDED[@]}"; kv "Adding" "$REPLY"; fi
  if ((${#CH_REMOVED[@]})); then
    room_names "${CH_REMOVED[@]}"; kv "Removing" "$REPLY"
    note "Their files, packages and pages go. What you saved, followed and watched"
    note "stays in your database and comes back if you add them again."
  fi
  if ((${#implied[@]})); then
    room_names "${implied[@]}"
    note "$REPLY $( ((${#implied[@]} == 1)) && echo goes || echo go) along: a room comes and goes with the rooms it needs."
    if ((CAN_ASK)) && ! ask "Go ahead?" Y; then printf '\n'; exit 0; fi
  fi
}

changed_done() {
  local bits=()
  if ((${#CH_ADDED[@]})); then room_names "${CH_ADDED[@]}"; bits+=("Added $REPLY."); fi
  if ((${#CH_REMOVED[@]})); then room_names "${CH_REMOVED[@]}"; bits+=("Removed $REPLY."); fi
  printf '\n  %s%s%s %s\n' "$GOOD" "$G_OK" "$RST" "${bits[*]}"
  note "Reload Tubcal in your browser to see the change."
  printf '\n'
}

# --list: every room, by channel, and which are installed.
do_list() {
  locate_app
  load_manifest
  local rec=0 id ch box alias
  if [[ -r $CONF ]]; then load_previous; rec=1; fi
  printf '\n'
  for ch in social coding video; do
    printf '  %s%s%s\n' "$DIM" "${ch^^}" "$RST"
    for id in "${MOD_IDS[@]}"; do
      [[ ${MAN[$id.channel]} == "$ch" ]] || continue
      if ((!rec)); then box=" "; elif ((ON[$id])); then box="$GOOD$G_ON$RST"; else box="$DIM$G_OFF$RST"; fi
      alias=${MAN[$id.aliases]:-}
      printf '   %s  %-20s %-11s %s%s%s\n' "$box" "${MAN[$id.name]}" "$id" "$DIM" "${alias:+also: ${alias// /, }}" "$RST"
    done
  done
  printf '\n'
  if ((rec)); then
    note "$G_ON installed   $G_OFF left out"
    note "tubcal add ROOM   tubcal remove ROOM   (its id or any of its names)"
  else
    note "Nothing installed yet: install.sh offers these as a menu."
  fi
  printf '\n'
}

do_uninstall() {
  [[ -r $CONF ]] || die "Nothing to uninstall: no install record at $CONF."
  # shellcheck source=/dev/null
  . "$CONF"
  rule "SIGNING OFF"
  local cloned=${CLONED:-0}
  tilde "$APP_DIR"; local app=$REPLY
  note "Removes the launcher, menu entry, service and autostart, and Tubcal's"
  note "private uv, Node and yt-dlp. Distro packages stay installed."
  if ((cloned)); then
    if ((PURGE)); then note "--purge: $app goes too, ${BOLD}data included${RST}${DIM}."
    else note "$app (the app and your data) is kept; --purge removes it."; fi
  else
    note "$app is your own checkout and is left as it is."
  fi
  if ((!YES)); then
    ((CAN_ASK)) || die "No terminal to confirm on; pass --yes to uninstall."
    ask "Sign off?" N || { printf '\n'; exit 0; }
  fi
  [[ -x $BIN_DIR/tubcal ]] && "$BIN_DIR/tubcal" stop >/dev/null 2>&1
  if has systemctl && [[ -f $UNIT_DIR/tubcal.service ]]; then
    systemctl --user disable --now tubcal.service >/dev/null 2>&1
    rm -f "$UNIT_DIR/tubcal.service"
    systemctl --user daemon-reload >/dev/null 2>&1
  fi
  rm -f "$BIN_DIR/tubcal" "$APPS_DIR/tubcal.desktop" "$ICON_DIR/tubcal.svg" "$XDG_CONF/autostart/tubcal.desktop"
  has update-desktop-database && update-desktop-database -q "$APPS_DIR" 2>/dev/null
  rm -rf "${TUBCAL_HOME:?}/bin" "$TUBCAL_HOME/tools" "$TUBCAL_HOME/node" "$CONF"
  rm -rf "$STATE_DIR" "$PHONE_CACHE"
  # Only ever a folder that is unmistakably a Tubcal clone.
  if ((cloned && PURGE)) && is_tubcal_dir "$APP_DIR"; then rm -rf "$APP_DIR"; fi
  rmdir "$TUBCAL_HOME" 2>/dev/null
  printf '\n  %s%s%s Signed off.\n' "$GOOD" "$G_OK" "$RST"
  [[ -n ${PKGS_ADDED:-} ]] && note "Installed from your distro along the way (still there): $PKGS_ADDED"
  printf '\n'
}

main() {
  parse_args "$@"
  ui_init
  trap cleanup EXIT
  trap on_interrupt INT TERM
  mkdir -p "$STATE_DIR"
  LOG="$STATE_DIR/install-$(date +%Y%m%d-%H%M%S).log"
  NOTE_FILE=$(mktemp "${TMPDIR:-/tmp}/tubcal-note.XXXXXX")
  WARN_FILE="$NOTE_FILE.warn" WHY_FILE="$NOTE_FILE.why"
  # keep the five newest install logs
  ls -1t "$STATE_DIR"/install-*.log 2>/dev/null | tail -n +6 | while IFS= read -r f; do rm -f "$f"; done
  case $MODE in
    uninstall) do_uninstall ;;
    list) do_list ;;
    phone) do_phone ;;
    *) do_install ;;
  esac
  rm -f "$WARN_FILE"
}

# modules.ini without the paths: what the menu shows before there's a checkout
# to read (an install piped from curl). tests/test_modules.py keeps it equal to
# modules.ini; copy any change there over here.
embedded_manifest() {
  cat <<'MODULES_INI'
[edition]
name = The Edition
channel = social
about = A daily paper composed from the rooms you follow; Ollama writes it up.
aliases = paper
size = 20 MB
needs =
extras = edition
groups =
tools =
packages =

[hackernews]
name = The Wire
channel = social
about = Hacker News: the six lists, search, and threads that mark what's new.
aliases = wire hn
size = under 1 MB
needs =
extras =
groups =
tools =
packages =

# Not a room: a page of the Wire's, shown in the Social bar with 3D objects on.
[topics]
name = By topic
channel = social
about = The Wire's front page sorted into five topics by Ollama, as a 3D machine.
aliases = bytopic sorter
size = under 1 MB
needs = hackernews
extras =
groups =
tools =
packages =

[reddit]
name = The Dispatch
channel = social
about = Reddit: your subreddits and their threads, with or without an account.
aliases = dispatch
size = under 1 MB
needs =
extras =
groups =
tools =
packages =

[editor]
name = The Composing Room
channel = coding
about = A vim code editor over ~/Projects, with a terminal and language servers.
aliases = composing composer
size = 2 MB
needs =
extras = editor
groups =
tools =
packages = ripgrep

[dev]
name = The Workbench
channel = coding
about = One manual per programming language: docs, talks, podcasts, releases.
aliases = workbench bench
size = under 1 MB
needs =
extras =
groups =
tools =
packages =

[github]
name = GitHub
channel = coding
about = Repos, releases, trending and your inbox; clones into ~/Projects.
aliases = gh
size = 1 MB
needs =
extras =
groups =
tools =
packages =

[youtube]
name = The Screening Room
channel = video
about = YouTube without an account: your channels, search, live streams.
aliases = screening yt
size = 60 MB
needs =
extras =
groups =
tools = yt-dlp
packages = notify

[anime]
name = The Anime
channel = video
about = Anime with your AniList list: seasons, schedule, episodes, the forum.
aliases = anilist
size = 100 MB
needs =
extras =
groups = anime
tools =
packages =

[archive]
name = The Archive
channel = video
about = Transcribes what you watch, on this machine, so you can search and ask it.
aliases = brain
size = 300 MB
needs = youtube
extras = brain
groups =
tools =
packages =
MODULES_INI
}

main "$@"
