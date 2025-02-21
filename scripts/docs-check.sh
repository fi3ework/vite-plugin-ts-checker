echo "prev commit: $CACHED_COMMIT_REF"
echo "current commit: $COMMIT_REF"
git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF docs package.json pnpm-lock.yaml netlify.toml scripts/docs-check.sh
has_diff=$?
git describe --exact-match --tags $(git log -n1 --pretty='%h')
has_tag=$?

echo "diff exit code: $has_diff"
echo "tag exit code: $has_tag"

exit $(($has_diff || $has_tag))