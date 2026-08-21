.PHONY: dev fresh deploy-local deploy version

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

# Local install: build the .app, put it in /Applications, and register the
# aierbaer:// URL scheme with LaunchServices (needed for deep links).
deploy-local:
	npm run tauri build -- --bundles app
	rm -rf "/Applications/$(APP_NAME).app"
	cp -R "$(BUNDLE)" "/Applications/$(APP_NAME).app"
	"$(LSREGISTER)" -f "/Applications/$(APP_NAME).app"
	@echo "Installed → /Applications/$(APP_NAME).app (aierbaer:// registered)"

# Ask a pi agent to suggest the next version from changes since the last release.
version:
	@./scripts/suggest-version.sh

# Release: bump the version, commit, tag, and push. Pushing the v<x.y.z> tag
# triggers the GitHub Actions release workflow, which builds the .dmg and
# publishes it to the repo's Releases page for others to download.
# Add the matching entry to src/lib/releaseNotes.ts + CHANGELOG.md first.
# Usage: make deploy               (default: a pi agent picks from the changes)
#        make deploy V=0.3.0        (explicit version)
#        make deploy BUMP=minor     (patch | minor | major from current)
deploy:
	@set -e; \
	VER="$(V)"; \
	if [ -z "$$VER" ] && [ -z "$(BUMP)" ]; then \
	  VER=$$(./scripts/suggest-version.sh); echo "pi suggested v$$VER"; \
	fi; \
	if [ -z "$$VER" ]; then \
	  CUR=$$(node -p "require('./package.json').version"); \
	  case "$(BUMP)" in \
	    major) VER=$$(echo $$CUR | awk -F. '{print $$1+1".0.0"}');; \
	    minor) VER=$$(echo $$CUR | awk -F. '{print $$1"."$$2+1".0"}');; \
	    patch) VER=$$(echo $$CUR | awk -F. '{print $$1"."$$2"."$$3+1}');; \
	    *) echo "Provide V=x.y.z, BUMP=patch|minor|major, or AUTO=1 (current $$CUR)"; exit 1;; \
	  esac; \
	fi; \
	echo "$$VER" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo "bad version: $$VER"; exit 1; }; \
	grep -q "\"version\": \"$$VER\"" src/lib/releaseNotes.ts || { echo "!! Add a v$$VER entry to src/lib/releaseNotes.ts and CHANGELOG.md first"; exit 1; }; \
	echo "Releasing v$$VER"; \
	sed -i '' "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$$VER\"/" package.json src-tauri/tauri.conf.json; \
	sed -i '' "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$$VER\"/" src-tauri/Cargo.toml; \
	git -c commit.gpgsign=false commit -am "release: v$$VER"; \
	git tag "v$$VER"; \
	git push origin main --follow-tags; \
	echo "Pushed v$$VER — GitHub Actions is building the release; the .dmg will appear under Releases."
