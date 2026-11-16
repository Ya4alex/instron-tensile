import { useRef, useState } from 'react';

async function* walk(item: any): AsyncGenerator<File> {
  const handle = await item.getAsFileSystemHandle?.();
  if (handle && handle.kind === 'directory') {
    for await (const child of handle.values()) {
      if (child.kind === 'file') {
        const f = await child.getFile();
        yield f;
      } else {
        yield* walkDir(child);
      }
    }
  } else {
    const f = item.getAsFile?.();
    if (f) yield f;
  }
}

async function* walkDir(dir: any): AsyncGenerator<File> {
  for await (const child of dir.values()) {
    if (child.kind === 'file') yield await child.getFile();
    else yield* walkDir(child);
  }
}

export function DropZone({ onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (list: FileList | null) => {
    if (!list) return;
    onFiles(Array.from(list).filter((f) => /\.csv$/i.test(f.name)));
  };

  const inputs = (
    <>
      <input
        ref={dirInput}
        type="file"
        hidden
        // @ts-expect-error нестандартный атрибут
        webkitdirectory=""
        onChange={(e) => pick(e.target.files)}
      />
      <input ref={fileInput} type="file" hidden multiple accept=".csv" onChange={(e) => pick(e.target.files)} />
    </>
  );

  if (compact)
    return (
      <span className="dz-compact">
        <button onClick={() => dirInput.current?.click()} title="Добавить папку">📁</button>
        <button onClick={() => fileInput.current?.click()} title="Добавить файлы CSV">📄</button>
        {inputs}
      </span>
    );

  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        const files: File[] = [];
        for (const item of Array.from(e.dataTransfer.items))
          for await (const f of walk(item)) if (/\.csv$/i.test(f.name)) files.push(f);
        if (files.length) onFiles(files);
        else pick(e.dataTransfer.files);
      }}
    >
      <button onClick={() => dirInput.current?.click()}>Загрузить папку</button>
      <button onClick={() => fileInput.current?.click()}>+ файлы CSV</button>
      <span className="hint">или перетащите папки / CSV сюда</span>
      {inputs}
    </div>
  );
}
