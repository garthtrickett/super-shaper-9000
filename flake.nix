{
  description = "typescript dev environment with android support";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "aarch64-linux";

      # 1. Native packages (ARM)
      pkgs = import nixpkgs {
        inherit system;
        config = {
          allowUnfree = true;
          android_sdk.accept_license = true;
        };
      };

      # 2. x86_64 packages (Source of libs for QEMU)
      pkgsX86 = import nixpkgs {
        system = "x86_64-linux";
        config.allowUnfree = true;
      };

      androidComposition = pkgs.androidenv.composeAndroidPackages {
        cmdLineToolsVersion = "11.0";
        platformToolsVersion = "35.0.2";
        buildToolsVersions = [ "35.0.0" "34.0.0" ];
        includeEmulator = false;
        platformVersions = [ "35" "34" ];
        includeSources = false;
        includeSystemImages = false;
      };

      androidSdk = androidComposition.androidsdk;
    in
    {
      devShells.${system}.default = pkgs.mkShell {
                nativeBuildInputs = with pkgs;[
          bashInteractive
          pkg-config
          lld
        ];

        buildInputs = with pkgs; [
          # --- NODE / JS ---
          nodejs_20
          bun
          esbuild

          # --- PLAYWRIGHT ---
          chromium

          # --- ANDROID DEV ---
          jdk21
          gradle
          android-tools
          androidSdk

                    # --- UTILS ---
          unzip
          curl

          # --- RUST / WASM ---
          rustc
          cargo
          rust-analyzer
          wasm-pack
          rustup
        ];

        shellHook = ''
          echo "🚀 Bedrock Dev Environment Loaded"
          echo "Node: $(node --version)"
          
          # --- PLAYWRIGHT CONFIG ---
          export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
          export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"

          # --- PLAYWRIGHT UI MODE FIX ---
          # Playwright's UI mode ignores the config executablePath and strictly looks for
          # 'google-chrome' or 'google-chrome-stable' in the PATH on Linux.
          # We alias our nix chromium to trick it into launching the trace viewer.
          mkdir -p .nix-bins
          ln -sf "${pkgs.chromium}/bin/chromium" .nix-bins/google-chrome
          ln -sf "${pkgs.chromium}/bin/chromium" .nix-bins/google-chrome-stable
          export PATH="$PWD/.nix-bins:$PATH"

          # --- ANDROID CONFIG ---
          export ANDROID_SDK_ROOT="${androidSdk}/libexec/android-sdk"
          export ANDROID_HOME=$ANDROID_SDK_ROOT
          export JAVA_HOME="${pkgs.jdk21}"

          alias adb="${pkgs.android-tools}/bin/adb"

          # --- QEMU COMPATIBILITY FIX FOR AAPT2 (x86_64) ---
          # Gradle extracts unpatched x86_64 binaries. We need QEMU to find the loader at /lib64.
          # We construct a fake root for QEMU_LD_PREFIX.
          
          QEMU_ROOT="$HOME/.local/share/qemu-x86-root"
          mkdir -p "$QEMU_ROOT"

          # 1. Symlink x86_64 glibc lib folder to lib64 in our fake root
          if [ ! -d "$QEMU_ROOT/lib64" ]; then
             echo "🔧 Setting up QEMU x86_64 compatibility layer..."
             ln -s "${pkgsX86.glibc}/lib" "$QEMU_ROOT/lib64"
             
             # Also link lib, just in case
             ln -s "${pkgsX86.glibc}/lib" "$QEMU_ROOT/lib"
          fi

          # 2. Tell QEMU to use this root for unpatched binaries
          export QEMU_LD_PREFIX="$QEMU_ROOT"
          
          # 3. Add x86_64 libs to LD_LIBRARY_PATH so the binary can find libc.so.6 etc.
          # We append the x86 libs to the ARM libs path (the linker usually handles arch mismatch by skipping, 
          # but we need it visible for the x86 process).
          export LD_LIBRARY_PATH="${pkgsX86.glibc}/lib:${pkgsX86.gcc.cc.lib}/lib:${pkgsX86.zlib}/lib:$LD_LIBRARY_PATH"

                    echo "✅ QEMU_LD_PREFIX set to allow unpatched x86_64 AAPT2 execution."

          # --- RUST WASM TARGET ---
          rustup target add wasm32-unknown-unknown 2>/dev/null || echo "⚠️ Please run 'rustup toolchain install stable' first if rustup is not configured."
          
          # Clean up any stale gradle daemons to ensure they pick up the new env vars
          ${pkgs.gradle}/bin/gradle --stop >/dev/null 2>&1 || true
        '';
      };
    };
}
