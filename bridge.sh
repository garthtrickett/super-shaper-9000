#!/usr/bin/env bash
WATCH_DIR="$HOME/Downloads"
PROJECT_DIR="$HOME/files/code/super-shaper-9000"
cd "$PROJECT_DIR" || exit

inotifywait -m -e close_write -e moved_to --format '%f' "$WATCH_DIR" | while read -r FILE; do
    if [[ "$FILE" == *.json ]] || [[ "$FILE" == *.txt ]] || [[ "$FILE" == *.ts ]]; then
        sleep 0.2
        FULL_PATH="$WATCH_DIR/$FILE"

        if [ -f "$FULL_PATH" ]; then
            echo "📂 Detected: $FILE"
            cp "$FULL_PATH" "current_response.json"

            # Run Python and capture output
            PYTHON_OUT=$(python3 apply_changes.py "current_response.json")
            EXIT_CODE=$?
            echo "$PYTHON_OUT"

            if [ $EXIT_CODE -eq 0 ]; then
                # SUCCESS CASE
                SUMMARY=$(echo "$PYTHON_OUT" | grep "🤖 Summary:" | sed 's/🤖 Summary: //')

                # --- ADDED: Show the diff before staging ---
                echo -e "\n🔍 Reviewing changes:"
                git diff --color=always | sed 's/^/  /'
                echo -e "\n"
                # -------------------------------------------

                git add .
                git commit -m "${SUMMARY:-Gemini Update}"

                echo "📜 Files Changed:"
                git show --name-only --format="" HEAD | sed 's/^/  📄 /'
                notify-send "Gemini Success" "All changes applied and committed."
            else
                # FAILURE CASE
                echo "⛔ TRANSACTION FAILED: One or more blocks did not match."
                echo "No files were modified. Re-sync your codebase in Gemini and try again."
                notify-send -u critical "Gemini Failed" "Search blocks mismatch. No changes applied."
            fi

            rm "current_response.json"
            rm "$FULL_PATH"
            echo "----------------------------------------"
        fi
    fi
done
