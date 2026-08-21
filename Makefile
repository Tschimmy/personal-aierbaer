.PHONY: dev fresh deploy new-version

APP_NAME := Personal Aierbaer
BUNDLE := src-tauri/target/release/bundle/macos/$(APP_NAME).app
LSREGISTER := /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

# Normal dev run against your real environment.
dev:
	npm run tauri dev

# Fresh onboarding test: reset the sandbox, then launch the app inside it
# (no pi, no skill, no Copilot auth, fresh app state) via test-onboarding.sh,
# which runs `npm run tauri dev` in the sandboxed env.
fresh:
	./test-onboarding.sh clean
	./test-onboarding.sh

# Build the .app, install it to /Applications, and register the aierbaer://
# URL scheme with LaunchServices (needed for deep links to resolve).
deploy:
	npm run tauri build -- --bundles app
	rm -rf "/Applications/$(APP_NAME).app"
	cp -R "$(BUNDLE)" "/Applications/$(APP_NAME).app"
	"$(LSREGISTER)" -f "/Applications/$(APP_NAME).app"
	@echo "Deployed → /Applications/$(APP_NAME).app (aierbaer:// registered)"

# Bump the version across package.json, Cargo.toml, and tauri.conf.json.
# Usage: make new-version V=0.3.0
# Remember to add the matching entry to CHANGELOG.md and src/lib/releaseNotes.ts first.
new-version:
	@test -n "$(V)" || (echo "Usage: make new-version V=x.y.z"; exit 1)
	@echo "$(V)" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$' || (echo "V must be semantic (x.y.z)"; exit 1)
	sed -i '' 's/"version": "[0-9]*\.[0-9]*\.[0-9]*"/"version": "$(V)"/' package.json src-tauri/tauri.conf.json
	sed -i '' 's/^version = "[0-9]*\.[0-9]*\.[0-9]*"/version = "$(V)"/' src-tauri/Cargo.toml
	@grep -q '"version": "$(V)"' src/lib/releaseNotes.ts || echo "!! Add a v$(V) entry to src/lib/releaseNotes.ts and CHANGELOG.md"
	@echo "Bumped to $(V) (package.json, Cargo.toml, tauri.conf.json)"
