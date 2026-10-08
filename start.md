Open Terminal and run:

```
cd "/Applications/PlayGround/Choto Rafi"
PATH="/Users/tanvir/.cargo/bin:$PATH" npx tauri build --bundles app
```

The rebuilt app will appear here:

```
src-tauri/target/release/bundle/macos/CHOTO YOU.app
```

For development mode with automatic rebuilding:

```
cd "/Applications/PlayGround/Choto Rafi"
PATH="/Users/tanvir/.cargo/bin:$PATH" npm run tauri:dev
```
