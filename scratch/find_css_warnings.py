import re

css = open(r'd:\Content OS\src\styles\global.css', encoding='utf-8').read()

print("=== CHECKING INVALID / OUTDATED CSS PROPERTIES IN GLOBAL.CSS ===")

invalid_props = ['-moz-column-gap', '-moz-osx-font-smoothing', 'speak:', '-webkit-text-size-adjust']

for prop in invalid_props:
    count = css.count(prop)
    print(f"Property '{prop}': found {count} occurrences")
    for m in re.finditer(rf'([^{{}}]*{re.escape(prop)}[^{{}}]*)\{{([^}}]*)}}', css):
        print("  SELECTOR:", m.group(1).strip())
        print("  BODY:", m.group(2).strip()[:100])
