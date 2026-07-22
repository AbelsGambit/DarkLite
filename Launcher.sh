#!/bin/bash
# LostCity Launcher v0.1

cd "$(dirname "$0")"

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
    echo "=========================================="
    echo "  What would you like to do?"
    echo "=========================================="
    echo "  1. Play (build + launch client)"
    echo "  2. Start Server only (bun start)"
    echo "  3. Clean Build (wipe cache + restart)"
    echo "  4. Open Dashboard (web UI)"
    echo "  5. Exit"
    echo "=========================================="
    read -p "Enter choice (1-5): " choice

    case $choice in
        1)
            echo ""
            echo "[1/3] Starting game server..."
            cd engine && bun start &
            SERVER_PID=$!
            echo "[2/3] Waiting for server to start..."
            sleep 8
            echo "[3/3] Launching client..."
            cd ../client && ./gradlew run
            kill $SERVER_PID 2>/dev/null
            cd ..
            ;;
        2)
            echo ""
            echo "Starting server..."
            cd engine && bun start
            cd ..
            ;;
        3)
            echo ""
            echo "[1/3] Cleaning build..."
            cd engine && npm run clean
            echo "[2/3] Cleaning .file_store_32..."
            rm -rf ~/.file_store_32 2>/dev/null
            rm -rf /.file_store_32 2>/dev/null
            echo "[3/3] Starting fresh server..."
            cd engine && bun start &
            sleep 8
            echo "Done! Server is running."
            cd ..
            ;;
        4)
            echo ""
            echo "Starting dashboard..."
            cd dashboard && bun run dev &
            sleep 5
            xdg-open http://localhost:3000 2>/dev/null || open http://localhost:3000 2>/dev/null
            cd ..
            ;;
        5)
            exit 0
            ;;
    esac
done
