#!/bin/bash
# ══════════════════════════════════════════
# WhatsApp Meter — Build Script
# Run this once to create the .dmg installer
# ══════════════════════════════════════════
set -e

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   WhatsApp Meter — Build Installer   ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "  ✗ Node.js not found."
  echo "    Install it from https://nodejs.org (LTS version)"
  echo ""
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "  ✗ Node.js $NODE_VERSION found, but 18+ is required."
  echo "    Install the latest LTS from https://nodejs.org"
  echo ""
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

# Install dependencies
echo "  → Installing dependencies..."
npm install --no-audit --no-fund 2>&1 | tail -1
echo "  ✓ Dependencies installed"

# Detect platform and build
OS=$(uname -s)
ARCH=$(uname -m)

if [ "$OS" = "Darwin" ]; then
  echo "  → Building macOS .dmg..."
  echo "    (this may take 1-2 minutes on first run)"
  npx electron-builder --mac --publish=never 2>&1 | grep -E "packaging|building|dmg|Done" || true

  DMG=$(find dist -name "*.dmg" -type f 2>/dev/null | head -1)
  if [ -n "$DMG" ]; then
    echo ""
    echo "  ══════════════════════════════════════"
    echo "  ✓ Build complete!"
    echo ""
    echo "  Your installer: $DMG"
    echo "  ══════════════════════════════════════"
    echo ""

    # Open the folder containing the .dmg
    open "$(dirname "$DMG")" 2>/dev/null || true
  else
    echo "  ✗ Build may have failed — check the dist/ folder"
  fi

elif [ "$OS" = "Linux" ]; then
  echo "  → Building Linux AppImage..."
  npx electron-builder --linux --publish=never 2>&1 | grep -E "packaging|building|AppImage|Done" || true

  APPIMAGE=$(find dist -name "*.AppImage" -type f 2>/dev/null | head -1)
  if [ -n "$APPIMAGE" ]; then
    echo ""
    echo "  ══════════════════════════════════════"
    echo "  ✓ Build complete!"
    echo ""
    echo "  Your installer: $APPIMAGE"
    echo "  ══════════════════════════════════════"
  else
    echo "  ✗ Build may have failed — check the dist/ folder"
  fi

else
  echo "  → Building Windows installer..."
  npx electron-builder --win --publish=never 2>&1 | grep -E "packaging|building|nsis|exe|Done" || true

  EXE=$(find dist -name "*.exe" -type f 2>/dev/null | head -1)
  if [ -n "$EXE" ]; then
    echo ""
    echo "  ══════════════════════════════════════"
    echo "  ✓ Build complete!"
    echo ""
    echo "  Your installer: $EXE"
    echo "  ══════════════════════════════════════"
  else
    echo "  ✗ Build may have failed — check the dist/ folder"
  fi
fi
