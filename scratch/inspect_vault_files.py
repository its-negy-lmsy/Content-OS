import os, mimetypes

vault_dir = r'd:\Content OS\database\assets_vault'

print("=== INSPECTING ALL FILES IN DATABASE/ASSETS_VAULT ===")

for root, dirs, files in os.walk(vault_dir):
    for f in files:
        full_path = os.path.join(root, f)
        rel_path = os.path.relpath(full_path, vault_dir)
        mime, _ = mimetypes.guess_type(full_path)
        print(f"FILE: {rel_path}")
        print(f"  MIME TYPE: {mime}")
        print(f"  SIZE: {os.path.getsize(full_path)} bytes")
        print("-" * 50)
