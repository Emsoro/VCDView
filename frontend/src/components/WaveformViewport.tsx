import WaveformCanvas from "./WaveformCanvas";
import { useAppStore } from "../state/store";
import { openFile } from "../api/tauricpp";
import { FiFolder } from "react-icons/fi";

export default function WaveformViewport() {
  const doc = useAppStore((s) => s.doc);

  if (!doc.opened) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-panel2 bg-panel/60">
          <FiFolder size={30} className="text-accent2" />
        </div>
        <div className="text-center">
          <p className="text-[14px] font-medium text-text1">VCDView</p>
          <p className="mt-1 text-[12px] text-text2">打开一个 VCD 波形文件开始查看</p>
        </div>
        <button
          onClick={async () => {
            const res = await openFile();
            if (res) {
              useAppStore.getState().setDocOpened(res.info, res.tree);
            }
          }}
          className="rounded-md bg-accent px-4 py-2 text-[12px] font-medium text-text1 transition hover:bg-accent2"
        >
          打开 VCD 文件
        </button>
      </div>
    );
  }

  return <WaveformCanvas />;
}
