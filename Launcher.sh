#!/bin/bash
# LostCity Launcher v0.1

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=========================================="
echo "       LostCity Launcher v0.1"
echo "=========================================="
echo ""

# Check dependencies
if ! command -v bun &> /dev/null; then
    echo "[ERROR] Bun is not installed. Get it from https://bun.sh"
    exit 1
fi
if ! command -v java &> /dev/null; then
    echo "[ERROR] Java is not installed. Get JDK 11+ from https://adoptium.net"
    exit 1
fi

echo "[OK] Bun found"
echo "[OK] Java found"
echo ""

while true; do
    cd "$ROOT"
    echo "=========================================="
    echo "  What would you like to do?"
    echo "=========================================="
    echo "  1. Play (start server + launch client)"
    echo "  2. Start Server only (bun start)"
    echo "  3. Clean Build (wipe cache + restart)"
    echo "  4. Open Dashboard (web UI for config)"
    echo "  5. Install Dependencies (first time setup)"
    echo "  6. Exit"
    echo "=========================================="
    read -p "Enter choice (1-6): " choice

    case $choice in
        1)
            echo ""
            echo "[1/3] Starting game server..."
            cd "$ROOT/engine" && bun start &
            SERVER_PID=$!
            echo "[2/3] Waiting for server to start..."
            sleep 8
            echo "[3/3] Launching client..."
            cd "$ROOT/client" && ./gradlew run
            kill $SERVER_PID 2>/dev/null
            ;;
        2)
            echo ""
            echo "Starting server..."
            cd "$ROOT/engine" && bun start
            ;;
        3)
            echo ""
            echo "[1/3] Cleaning build..."
            cd "$ROOT/engine" && npm run clean
            echo "[2/3] Cleaning .file_store_32..."
            rm -rf ~/.file_store_32 2>/dev/null
            rm -rf /.file_store_32 2>/dev/null
            echo "[3/3] Starting fresh server..."
            cd "$ROOT/engine" && bun start &
            sleep 8
            echo "Done! Server is running."
            ;;
        4)
            echo ""
            echo "Starting dashboard..."
            cd "$ROOT/dashboard"
            if [ ! -d "node_modules" ]; then
                echo "First run: installing dependencies..."
                bun install
            fi
            bun run dev &
            sleep 8
            echo "Opening browser..."
            xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null
            ;;
        5)
            echo ""
            echo "[1/2] Installing engine dependencies..."
            cd "$ROOT/engine" && bun install
            echo "[2/2] Installing dashboard dependencies..."
            cd "$ROOT/dashboard" && bun install
            echo "Done! Dependencies installed."
            ;;
        6)
            exit 0
            ;;
    esac
done
