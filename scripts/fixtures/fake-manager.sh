#!/bin/sh
# Test stub for `npm` and `cargo`: records the argv (so tests can prove where things were
# installed) and creates/removes a fake bin. Both managers accept the same shape we build:
#   npm install --prefix <dir> … <pkg>   /  npm uninstall --prefix <dir> <pkg>
#   cargo install --root <dir> … <crate> /  cargo uninstall --root <dir> <crate>
if [ -n "$FAKE_MANAGER_LOG" ]; then printf '%s\n' "$(basename "$0") $*" >> "$FAKE_MANAGER_LOG"; fi

case "$1" in
  --version)
    echo "stub 1.0.0"
    exit 0
    ;;
  install|uninstall)
    action="$1"
    shift
    dir=""; pkg=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --prefix|--root) dir="$2"; shift 2 ;;
        --*) shift ;;
        *) pkg="$1"; shift ;;
      esac
    done
    name=$(basename "$pkg")
    if [ "$action" = "install" ]; then
      mkdir -p "$dir/bin" "$dir/lib/node_modules/$pkg"
      printf '#!/bin/sh\necho stub\n' > "$dir/bin/$name"
      chmod +x "$dir/bin/$name"
      echo "added 1 package"
    else
      rm -rf "$dir/lib/node_modules/$pkg" "$dir/bin/$name"
      echo "removed 1 package"
    fi
    exit 0
    ;;
esac

echo "stub: 未处理的参数 $*" >&2
exit 1
