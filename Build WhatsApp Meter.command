#!/bin/bash
# ══════════════════════════════════════════════════════════════
# WhatsApp Meter — Double-click this file to build the app
# ══════════════════════════════════════════════════════════════
clear

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo ""
echo "  ┌──────────────────────────────────────┐"
echo "  │     Building WhatsApp Meter...        │"
echo "  │     This takes 1-2 minutes.           │"
echo "  │     Don't close this window.          │"
echo "  └──────────────────────────────────────┘"
echo ""

# ── Step 1: Check for Node.js ──
if ! command -v node &>/dev/null; then
  echo "  Node.js is needed but not installed."
  echo ""
  echo "  Installing it now via Homebrew..."
  echo ""

  # Install Homebrew if needed
  if ! command -v brew &>/dev/null; then
    echo "  Installing Homebrew first (this is a one-time thing)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add Homebrew to PATH for Apple Silicon Macs
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
  fi

  brew install node
  echo ""
fi

NODE_V=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_V" ] || [ "$NODE_V" -lt 18 ]; then
  echo "  ✗ Node.js 18+ is required (found: $(node -v 2>/dev/null || echo 'none'))"
  echo "    Go to https://nodejs.org and install the LTS version."
  echo ""
  echo "  Press any key to close..."
  read -n1
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

# ── Step 2: Install dependencies ──
echo "  → Installing dependencies..."
npm install --no-audit --no-fund --loglevel=error 2>&1
echo "  ✓ Dependencies ready"

# ── Step 3: Build the .dmg ──
echo "  → Building the macOS app..."
echo "    (this may take a minute or two)"
echo ""
npx electron-builder --mac --publish=never 2>&1 | while IFS= read -r line; do
  # Show only meaningful progress lines
  case "$line" in
    *packaging*|*building*|*signing*|*dmg*|*Done*|*error*|*Error*)
      echo "    $line"
      ;;
  esac
done

# ── Step 4: Find and open the result ──
DMG=$(find "$DIR/dist" -name "*.dmg" -type f 2>/dev/null | head -1)

if [ -n "$DMG" ]; then
  echo ""
  echo "  ══════════════════════════════════════"
  echo "  ✓ Done! Your app is ready."
  echo ""
  echo "  Opening the installer now..."
  echo "  ══════════════════════════════════════"
  echo ""

  # Open the .dmg directly — user just drags to Applications
  open "$DMG"
else
  echo ""
  echo "  ✗ Something went wrong. Check the output above."
  echo "    The dist/ folder may have partial results."
  echo ""
  open "$DIR/dist" 2>/dev/null
fi

echo "  Press any key to close this window..."
read -n1
