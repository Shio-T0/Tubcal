#!/bin/sh
# shellcheck shell=bash
#
# Tubcal installer: tunes a Linux machine in to Tubcal.
#
#   ./install.sh        from a checkout: sets that checkout up where it is
#   curl -fsSL https://raw.githubusercontent.com/Shio-T0/Tubcal/main/install.sh | bash
#                       from anywhere: clones into ~/.local/share/tubcal/app
#
# In order: distro packages (listed and asked about first; sudo is used for
# nothing else) → uv → Node.js → Python + the backend (uv sync) → the frontend
# build → a private, self-updating yt-dlp → the `tubcal` launcher, app-menu
# entry and optional login autostart → a self-test against a throwaway database.
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

MODE=install YES=0 NO_SUDO=0 PURGE=0 ANIM=1 NOCOLOR_FLAG=0 CLONE_DIR=""
declare -A FORCE=()

usage() {
  cat <<'EOF'
Tubcal installer

  ./install.sh [options]
  curl -fsSL https://raw.githubusercontent.com/Shio-T0/Tubcal/main/install.sh | bash -s -- [options]

Options
  -y, --yes            no questions: the defaults, or what you chose last time
      --with LIST      switch on, comma-separated: editor,archive,desktop,autostart,extras
      --without LIST   switch off any of the same
      --dir DIR        where to clone Tubcal when not run from a checkout
                       (default ~/.local/share/tubcal/app)
      --no-sudo        never ask for root: user-space installs only
      --update         re-sync, rebuild and restart with the saved choices
                       (what `tubcal update` runs after pulling)
      --uninstall      remove the launcher, menu entry, service and private tools
      --purge          with --uninstall: also delete a cloned app and its data
      --no-anim        skip the tuning-in animation
      --no-color       plain output (NO_COLOR is honoured too)
  -h, --help           this

Components
  editor     The Composing Room's terminal and LSP bridge (flask-sock)
  archive    The Archive: local transcription with faster-whisper (~300 MB)
  desktop    an app-menu entry and icon
  autostart  start the server when you log in
  extras     notify-send pings before streams go live, ripgrep for the editor

Environment
  TUBCAL_REPO, TUBCAL_BRANCH   what to clone (default: GitHub, main)
  TUBCAL_HOME                  installer-owned files (default ~/.local/share/tubcal)
  TUBCAL_BIN_DIR               where `tubcal` goes (default ~/.local/bin)
  TUBCAL_SYSTEMD=0             manage the server without systemd --user
EOF
}

parse_args() {
  local c
  while (($#)); do
    case $1 in
      -y|--yes) YES=1 ;;
      --with|--without)
        [[ $# -ge 2 ]] || { echo "$1 needs a list" >&2; exit 2; }
        local IFS=,
        for c in $2; do
          case $c in editor|archive|desktop|autostart|extras) ;; *) echo "unknown component: $c" >&2; exit 2 ;; esac
          [[ $1 == --with ]] && FORCE[$c]=1 || FORCE[$c]=0
        done
        shift ;;
      --with=*|--without=*) set -- "${1%%=*}" "${1#*=}" "${@:2}"; continue ;;
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

# ── choices ──────────────────────────────────────────────────────────────────

IDS=(core editor archive desktop autostart extras)
PREV_CLONED=""
declare -A ON=() LOCKED=()
PREV_LOADED=0

PREV_PKGS=""

load_previous() {
  [[ -r $CONF ]] || return 0
  local here=$APP_DIR
  local EDITOR_X="" ARCHIVE="" DESKTOP="" AUTOSTART="" EXTRAS="" APP_DIR="" CLONED=0
  local UV="" NODE_BIN="" BIN_DIR="" SYSTEMD="" PKGS_ADDED="" INSTALLED_AT=""
  # shellcheck source=/dev/null
  . "$CONF" 2>/dev/null || return 0
  PREV_LOADED=1 PREV_PKGS=$PKGS_ADDED
  # Re-running from inside a clone the installer made: still that clone.
  [[ $APP_DIR == "$here" ]] && PREV_CLONED=$CLONED
  [[ -n $EDITOR_X ]] && ON[editor]=$EDITOR_X
  [[ -n $ARCHIVE ]] && ON[archive]=$ARCHIVE
  [[ -n $DESKTOP ]] && ON[desktop]=$DESKTOP
  [[ -n $AUTOSTART ]] && ON[autostart]=$AUTOSTART
  [[ -n $EXTRAS ]] && ON[extras]=$EXTRAS
  return 0
}

default_choices() {
  local id
  for id in "${IDS[@]}"; do LOCKED[$id]=0; done
  ON[core]=1 LOCKED[core]=1
  : "${ON[editor]:=1}"
  if [[ -z ${ON[archive]:-} ]]; then
    ON[archive]=0
    compgen -G "$APP_DIR/.venv/lib/python*/site-packages/faster_whisper" >/dev/null && ON[archive]=1
  fi
  : "${ON[desktop]:=1}"
  : "${ON[autostart]:=0}"
  if [[ -z ${ON[extras]:-} ]]; then ON[extras]=$CAN_PKG; fi
  for id in "${!FORCE[@]}"; do ON[$id]=${FORCE[$id]}; done
  if ((!CAN_PKG)) && ! { has notify-send && has rg; }; then ON[extras]=0 LOCKED[extras]=1; fi
}

declare -A LABEL=(
  [core]="Tubcal itself"
  [editor]="Composing Room terminal & LSP"
  [archive]="The Archive: local transcription"
  [desktop]="App-menu entry & icon"
  [autostart]="Start when I log in"
  [extras]="Live-stream pings & fast grep"
)
declare -A DESC=(
  [core]="The backend, the built frontend, and a self-updating yt-dlp."
  [editor]="A real shell and language servers in the code-editor room."
  [archive]="Whisper transcribes what you watch, here. Pairs with Ollama."
  [desktop]="Launch Tubcal from your app menu like any other app."
  [autostart]="The server waits in the background; the app opens instantly."
  [extras]="A ping before a followed stream goes live; ripgrep for search."
)
side_note() {
  case $1 in
    core) REPLY="required" ;;
    editor) REPLY="flask-sock" ;;
    archive) REPLY="~300 MB" ;;
    desktop) REPLY="" ;;
    autostart) ((SYSTEMD)) && REPLY="systemd --user" || REPLY="XDG autostart" ;;
    extras)
      if ((LOCKED[extras] == 1)); then REPLY="needs distro packages"
      else REPLY="notify-send, rg"; fi ;;
  esac
}

_menu_draw() {
  local i id box lab ptr side pad
  for i in "${!IDS[@]}"; do
    id=${IDS[i]}
    if ((ON[$id])); then box="$GOOD$G_ON$RST"; else box="$DIM$G_OFF$RST"; fi
    ((LOCKED[$id] == 1)) && box="$DIM$( ((ON[$id])) && printf %s "$G_ON" || printf %s "$G_OFF")$RST"
    if ((i == CUR)); then ptr="$AMBER$G_PTR$RST" lab="$BOLD${LABEL[$id]}$RST"; else ptr=" " lab=${LABEL[$id]}; fi
    side_note "$id"; side=$REPLY
    pad=$((W - 9 - ${#LABEL[$id]} - ${#side}))
    ((pad < 1)) && pad=1
    printf '\r\e[K   %s %s  %s%*s%s%s%s\n' "$ptr" "$box" "$lab" "$pad" '' "$DIM" "$side" "$RST"
  done
  local d=${DESC[${IDS[CUR]}]}
  ((${#d} > W - 6)) && d="${d:0:W-7}…"
  printf '\r\e[K\n\r\e[K     %s%s%s\n' "$DIM" "$d" "$RST"
  printf '\r\e[K     %s↑↓ move   space toggle   enter continue   q quit%s\n' "$DIM" "$RST"
}

_menu_static() {
  local id
  for id in "${IDS[@]}"; do
    if ((ON[$id])); then printf '     %s%s%s  %s\n' "$GOOD" "$G_ON" "$RST" "${LABEL[$id]}"
    else printf '     %s%s  %s%s\n' "$DIM" "$G_OFF" "${LABEL[$id]}" "$RST"; fi
  done
}

choose_components() {
  rule "PROGRAMME"
  if ((!CAN_ASK)); then
    _menu_static
    ((YES)) || note "No terminal to ask on, so these are the defaults (--with/--without change them)."
    return
  fi
  note "Pick what to tune in."
  printf '\n'
  CUR=0
  local n=$((${#IDS[@]} + 3))
  hide_cursor
  _menu_draw
  while :; do
    read_key
    case $KEY in
      up) CUR=$(((CUR - 1 + ${#IDS[@]}) % ${#IDS[@]})) ;;
      down) CUR=$(((CUR + 1) % ${#IDS[@]})) ;;
      space)
        local id=${IDS[CUR]}
        ((LOCKED[$id] == 1)) || ON[$id]=$((1 - ON[$id])) ;;
      enter) break ;;
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
  [[ -n ${NOTE_FILE:-} ]] && rm -f "$NOTE_FILE"
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
    has notify-send || want notify
    has rg || want ripgrep
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
    git clone --depth 1 --branch "$TUBCAL_BRANCH" "$TUBCAL_REPO" "$APP_DIR"
  fi
  note_out "$(git -C "$APP_DIR" rev-parse --short HEAD)"
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

sync_backend() { # sync_backend WITH_ARCHIVE
  cd "$APP_DIR" || return 1
  local args=(sync --locked --no-progress)
  [[ -x .venv/bin/pytest ]] || args+=(--no-dev) # keep a developer's test deps
  ((ON[editor])) && args+=(--extra editor)
  (($1)) && args+=(--extra brain)
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
  "$NPM_BIN" run build || return 1
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
  local EDITOR_X=${ON[editor]} ARCHIVE=${ON[archive]} DESKTOP=${ON[desktop]}
  local AUTOSTART=${ON[autostart]} EXTRAS=${ON[extras]} INSTALLED_AT k
  INSTALLED_AT=$(date '+%Y-%m-%d %H:%M')
  {
    echo "# Tubcal's install record: written by install.sh, read by \`tubcal\`."
    echo "# Re-run install.sh (or \`tubcal update\`) rather than editing this."
    for k in APP_DIR CLONED UV NODE_BIN BIN_DIR EDITOR_X ARCHIVE DESKTOP AUTOSTART EXTRAS SYSTEMD PKGS_ADDED INSTALLED_AT; do
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
  TUBCAL_AUTO_UPDATE=0 .venv/bin/python - "$WARN_FILE" <<'PY' || return 1
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
    page = client.get("/")
    assert page.status_code == 200 and b'id="root"' in page.data, "the built frontend isn't being served"
finally:
    shutil.rmtree(tmp, ignore_errors=True)

late = {"rapidfuzz": "fuzzy search", "anipy_api.provider": "anime playback",
        "curl_cffi": "the backup anime source", "lxml": "the backup anime source"}
with open(sys.argv[1], "w") as out:
    for mod, feature in late.items():
        try:
            importlib.import_module(mod)
        except Exception as exc:
            out.write(f"{feature} may not work: {mod} won't load ({type(exc).__name__}: {exc})\n"[:300])
print("ok")
PY
  "$TUBCAL_HOME/bin/yt-dlp" --version >/dev/null || { echo "yt-dlp doesn't run"; return 1; }
  note_out "page + API answer"
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
  local x="backend"
  ((ON[editor])) && x+=" + editor"
  ((ON[archive])) && x+=" + archive"
  kv "Build" "$x $SEP frontend $SEP yt-dlp ${DIM}(private, refreshed daily)${RST}"
  tilde "$BIN_DIR"; local b=$REPLY
  local l="tubcal in $b"
  ((ON[desktop])) && l+=" $SEP app menu"
  ((ON[autostart])) && l+=" $SEP autostart"
  kv "Launcher" "$l"
  if ((ON[extras])) && ((!CAN_PKG)); then
    note "notify-send/ripgrep are only used if already installed."
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
  local inner=$((W - 4)) lines=() l cw=$((${#cmd} + 12))
  lines+=("")
  lines+=("$KAKI$G_ON$RST ${BOLD}ON AIR${RST}   Tubcal is installed.")
  lines+=("")
  lines+=("$(printf '%-*s' "$cw" "$cmd")${DIM}start it and open the browser${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd stop")${DIM}stop the server${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd status")${DIM}what's on, where, which versions${RST}")
  lines+=("$(printf '%-*s' "$cw" "$cmd update")${DIM}pull, rebuild, restart${RST}")
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
  has ollama || notes+=("No Ollama yet: The Archive and The Edition write with it (ollama.com).")
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
  load_previous
  [[ -n $PREV_CLONED ]] && CLONED=$PREV_CLONED
  PKGS_ADDED=$PREV_PKGS
  default_choices
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
    printf '\n  %sTubcal%s %s updating %s\n' "$BOLD$AMBER" "$RST" "$DIM" "$RST"
    plan_packages
    PKGS=() # an update never asks for root; missing tools take the user-space path
    preflight
  fi

  rule "ON THE FLOOR"
  if ((${#PKGS[@]})); then
    local ok=1
    if [[ $PRIV == sudo ]] && ! sudo -n true 2>/dev/null; then
      printf '\n'
      note "sudo, once, for: ${PKGS[*]}"
      sudo -v </dev/tty || ok=0
      printf '\n'
    fi
    if [[ $PRIV == doas ]]; then
      # doas can't lend a password to a background job, so this one runs in the open.
      STEP_N=$((STEP_N + 1))
      note "doas for: ${PKGS[*]}"
      install_packages </dev/tty || ok=0
    elif ((ok)) && ! run --soft "Distro packages" install_packages; then
      ok=0
    fi
    if ((ok)); then
      PKGS_ADDED="${PKGS_ADDED:+$PKGS_ADDED }${PKGS[*]}"
    else
      warn "Some distro packages didn't install; using user-space fallbacks where there are any."
    fi
  fi

  if ((CLONED)); then
    has git || die "git is needed to fetch Tubcal." "Install git, then run this again."
    run "Fetching Tubcal" fetch_source || die "Couldn't fetch $TUBCAL_REPO."
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

  if ((ON[archive])); then
    if ! run --soft "Python & backend, with The Archive" sync_backend 1 ||
      ! run --soft "The Archive's speech models load" check_archive; then
      warn "The Archive can't run on this machine, so it's left out (the rest is unaffected)."
      ON[archive]=0
    fi
  fi
  if ((!ON[archive])); then
    run "Python & backend" sync_backend 0 || die "uv sync failed."
  fi

  run "Building the frontend" build_frontend || die "The frontend build failed."
  run "yt-dlp (private, self-updating)" install_ytdlp || die "Couldn't install yt-dlp."
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
  on_air
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
  rm -rf "$STATE_DIR"
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
  WARN_FILE="$NOTE_FILE.warn"
  # keep the five newest install logs
  ls -1t "$STATE_DIR"/install-*.log 2>/dev/null | tail -n +6 | while IFS= read -r f; do rm -f "$f"; done
  case $MODE in
    uninstall) do_uninstall ;;
    *) do_install ;;
  esac
  rm -f "$WARN_FILE"
}

main "$@"
