#!/bin/sh
# Yapper installer for Linux, macOS and FreeBSD.
#
#   curl -fsSL https://raw.githubusercontent.com/dylan7077/yapper/main/install.sh | sh
#
# Installs Node.js 22 if needed (asks first), downloads Yapper to ~/yapper, installs its packages,
# sets it up to start automatically, and prints the dashboard address and setup code.
# Run it again any time to update; your settings in ~/yapper/storage are kept.
#
# Options (environment variables):
#   YAPPER_DIR=~/yapper   where to install
#   YAPPER_SERVICE=no        don't set up auto-start, just install
#   WEB_PORT=3080               dashboard port
#   YAPPER_TARBALL=file      install from a local .tar.gz instead of GitHub
set -eu

REPO="${YAPPER_REPO:-dylan7077/yapper}"
BRANCH="${YAPPER_BRANCH:-main}"
DIR="${YAPPER_DIR:-$HOME/yapper}"
PORT="${WEB_PORT:-3080}"
SERVICE="${YAPPER_SERVICE:-yes}"
OS="$(uname -s)"

if [ -t 1 ]; then B="$(printf '\033[1m')"; D="$(printf '\033[2m')"; G="$(printf '\033[32m')"; R="$(printf '\033[31m')"; N="$(printf '\033[0m')"; else B=; D=; G=; R=; N=; fi
step() { printf '\n%s==>%s %s%s%s\n' "$B" "$N" "$B" "$*" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
fail() { printf '\n  %s✗ %s%s\n\n' "$R" "$*" "$N" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
# Questions are read from the terminal, so this works when piped from curl.
ask() {
  [ -r /dev/tty ] || return 0
  printf '  %s [Y/n] ' "$1"
  read -r answer < /dev/tty || answer=
  case "$answer" in [nN]*) return 1 ;; *) return 0 ;; esac
}
sudo_cmd() { if [ "$(id -u)" = 0 ]; then "$@"; elif have sudo; then sudo "$@"; else fail "Need root for: $*  (install sudo or run as root)"; fi; }

printf '\n%sYapper installer%s\n' "$B" "$N"
printf '%sYour own AI bot for Discord · %s%s\n' "$D" "$OS" "$N"

# ---------- Node.js ----------
step "Checking Node.js"
node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]; }
if node_ok; then
  ok "Node.js $(node -v)"
else
  if have node; then printf '  Node.js %s is too old; Yapper needs 22 or newer.\n' "$(node -v)"; else printf '  Node.js is not installed.\n'; fi
  ask "Install Node.js 22 now?" || fail "Install Node.js 22+ from https://nodejs.org and run this again."
  case "$OS" in
    Linux)
      if have apt-get; then
        have curl || sudo_cmd apt-get install -y curl
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo_cmd bash -
        sudo_cmd apt-get install -y nodejs
      elif have dnf; then sudo_cmd dnf install -y nodejs npm
      elif have pacman; then sudo_cmd pacman -S --needed --noconfirm nodejs npm
      elif have zypper; then sudo_cmd zypper install -y nodejs22 npm22
      elif have apk; then sudo_cmd apk add nodejs npm
      else fail "Couldn't find a package manager I know. Install Node.js 22+ from https://nodejs.org and run this again."
      fi ;;
    Darwin)
      have brew || fail "Install Homebrew first (https://brew.sh), or Node.js 22+ from https://nodejs.org, then run this again."
      brew install node@22 && brew link --overwrite --force node@22 ;;
    FreeBSD) sudo_cmd pkg install -y node22 npm-node22 ;;
    *) fail "Install Node.js 22+ for $OS from https://nodejs.org and run this again." ;;
  esac
  hash -r 2>/dev/null || true
  node_ok || fail "Node.js 22+ still isn't available. Open a new terminal and run this again."
  ok "Node.js $(node -v)"
fi

# ---------- Download ----------
step "Downloading Yapper to $DIR"
mkdir -p "$DIR"
if [ -n "${YAPPER_TARBALL:-}" ]; then
  tar -xzf "$YAPPER_TARBALL" -C "$DIR" --strip-components=1
elif [ -d "$DIR/.git" ] && have git; then
  git -C "$DIR" pull --ff-only --quiet
else
  have curl || fail "curl is needed to download Yapper."
  # Unpacks over the old copy; storage/ and .env aren't in the download, so settings are kept.
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$DIR" --strip-components=1
fi
ok "Downloaded"

step "Installing packages"
(cd "$DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
mkdir -p "$DIR/storage"
ok "Installed"

# ---------- Auto-start ----------
NODE_BIN="$(command -v node)"
started=no
if [ "$SERVICE" != "no" ]; then
  step "Setting up auto-start"
  case "$OS" in
    Linux)
      if have systemctl && systemctl --user show-environment >/dev/null 2>&1; then
        mkdir -p "$HOME/.config/systemd/user"
        cat > "$HOME/.config/systemd/user/yapper.service" <<EOF
[Unit]
Description=Yapper Discord AI bot + dashboard
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
Environment=WEB_PORT=$PORT
ExecStart=$NODE_BIN --env-file-if-exists=.env src/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
        systemctl --user daemon-reload
        systemctl --user enable yapper >/dev/null 2>&1
        systemctl --user restart yapper
        # Keep running after logout (asks for your password once).
        loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q yes || { have sudo && sudo loginctl enable-linger "$(id -un)" 2>/dev/null || true; }
        ok "Runs as a systemd user service (systemctl --user status yapper)"
        started=yes
      fi ;;
    Darwin)
      PLIST="$HOME/Library/LaunchAgents/com.yapper.bot.plist"
      mkdir -p "$HOME/Library/LaunchAgents"
      cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.yapper.bot</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>--env-file-if-exists=.env</string><string>src/main.js</string></array>
  <key>EnvironmentVariables</key><dict><key>WEB_PORT</key><string>$PORT</string><key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/storage/yapper.log</string>
  <key>StandardErrorPath</key><string>$DIR/storage/yapper.log</string>
</dict></plist>
EOF
      launchctl unload "$PLIST" 2>/dev/null || true
      launchctl load -w "$PLIST"
      ok "Starts when you log in (launchd)"
      started=yes ;;
    FreeBSD)
      if ask "Install it as a system service (needs sudo)?"; then
        sudo_cmd cp "$DIR/deploy/yapper.rc" /usr/local/etc/rc.d/yapper
        sudo_cmd chmod +x /usr/local/etc/rc.d/yapper
        sudo_cmd sysrc yapper_enable=YES "yapper_user=$(id -un)" "yapper_dir=$DIR" >/dev/null
        sudo_cmd service yapper restart >/dev/null 2>&1 || sudo_cmd service yapper start
        ok "Runs as an rc.d service (service yapper status)"
        started=yes
      fi ;;
  esac
fi
if [ "$started" = no ]; then
  step "Starting Yapper"
  # Fully detached (own session, no terminal), so it keeps running after this script and the terminal exit.
  cd "$DIR"
  if have setsid; then set -- setsid; else set --; fi
  WEB_PORT="$PORT" "$@" nohup "$NODE_BIN" --env-file-if-exists=.env src/main.js >> storage/yapper.log 2>&1 < /dev/null &
  cd - >/dev/null
  ok "Started in the background (log: $DIR/storage/yapper.log)"
  printf '  %sIt won'\''t start again after a reboot. See the README to run it as a service.%s\n' "$D" "$N"
fi

# ---------- Done ----------
i=0
while [ ! -f "$DIR/storage/setup-code.txt" ] && [ ! -f "$DIR/storage/admin.json" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
case "$OS" in
  Darwin) IP="$(ipconfig getifaddr en0 2>/dev/null || true)" ;;
  Linux) IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    [ -n "$IP" ] || IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)" ;;
  *) IP="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}' || true)" ;;
esac

printf '\n%s✓ Yapper is running.%s\n\n' "$G$B" "$N"
printf '  Open the dashboard:  %shttp://localhost:%s%s\n' "$B" "$PORT" "$N"
[ -n "${IP:-}" ] && printf '  From another device: %shttp://%s:%s%s\n' "$B" "$IP" "$PORT" "$N"
if [ -f "$DIR/storage/setup-code.txt" ]; then
  printf '  Setup code:          %s%s%s\n' "$B" "$(cat "$DIR/storage/setup-code.txt")" "$N"
elif [ -f "$DIR/storage/admin.json" ]; then
  printf '  Sign in with your dashboard password.\n'
else
  printf '  The setup code is in %s/storage/yapper.log (or journalctl --user -u yapper).\n' "$DIR"
fi
printf '\n  The setup guide in the dashboard walks you through the rest.\n\n'
