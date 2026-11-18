"""Package the already-built extension without including source, keys, or profiles."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
build = root / 'dist'
manifest = json.loads((build / 'manifest.json').read_text(encoding='utf-8'))
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
if package['version'] != manifest['version']:
    raise SystemExit('Build and package versions differ; run npm run build first.')
for required in ['content.js', 'background.js', 'sidepanel.html', 'offscreen.html', 'ENGINE-SOURCE.txt', 'engine/COPYING.txt']:
    if not (build / required).is_file():
        raise SystemExit(f'Missing built asset: {required}')
output = root / 'releases'
output.mkdir(exist_ok=True)
archive = output / f"kibitz-{manifest['version']}.zip"
with ZipFile(archive, 'w', ZIP_DEFLATED, compresslevel=9) as package_zip:
    for file in sorted(build.rglob('*')):
        if file.is_file():
            package_zip.write(file, file.relative_to(build).as_posix())
with ZipFile(archive) as package_zip:
    if package_zip.testzip() is not None:
        raise SystemExit('Archive integrity check failed.')
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(f'{checksum}  {archive.name}\n', encoding='utf-8')
print(f'{archive}\nSHA-256: {checksum}')
