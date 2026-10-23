import { useEffect, useRef, useState } from "react";
import { PLATFORM_NAME, type AssistPackage, type VisualStyle } from "@hwpc/contracts";
import { copyText, downloadBlob, downloadUrl, isMobile } from "../../lib/share";
import { Alert, Icon } from "../ui";
import { CoverText, renderXhsCover } from "./Previews";

/**
 * 辅助发布：平台没有开放发布接口（或未绑定）时，三步完成发布，再回填链接。
 * 1. 复制文案  2. 保存图片  3. 打开 App 粘贴发布
 */
export function AssistSheet({ pkg, message, busy, onReceipt, onClose, visual }: {
  pkg: AssistPackage;
  /** 选定版本的视觉风格：封面图按它的配色与字体生成。 */
  visual?: VisualStyle;
  message: string;
  busy: boolean;
  onReceipt: (url?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"" | "text" | "title">("");
  const [saved, setSaved] = useState(0);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const mobile = isMobile();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const copy = async (what: "text" | "title") => {
    setError("");
    const ok = await copyText(what === "text" ? pkg.text : pkg.title);
    if (ok) setCopied(what);
    else setError("浏览器不允许自动复制，请长按下方文字手动复制");
  };

  const [coverSaved, setCoverSaved] = useState(false);
  const saveCover = async () => {
    setError("");
    try {
      downloadBlob(await renderXhsCover(pkg.images[0]?.url, pkg.coverText ?? pkg.title, visual), "小红书封面.png");
      setCoverSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "封面生成失败");
    }
  };

  const saveAll = async () => {
    setError("");
    try {
      for (const [i, im] of pkg.images.entries()) {
        await downloadUrl(im.url, `${PLATFORM_NAME[pkg.platform]}-${i + 1}.${im.url.includes("png") ? "png" : "jpg"}`);
        setSaved(i + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "图片保存失败");
    }
  };

  return (
    <dialog ref={dialog} className="sheet" onClose={onClose} aria-labelledby="assist-title">
      <header className="sheet-head">
        <h2 id="assist-title">发布到{PLATFORM_NAME[pkg.platform]}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialog.current?.close()} aria-label="关闭">关闭</button>
      </header>
      <p className="muted small">{message}</p>

      <ol className="assist-steps">
        <li>
          <div>
            <strong>复制文案</strong>
            <p className="muted small">{pkg.platform === "xiaohongshu" ? "标题和正文分开复制，小红书里标题单独一栏。" : "正文含行动引导和门店信息。"}</p>
          </div>
          <div className="row">
            {pkg.platform === "xiaohongshu" && (
              <button type="button" className="btn btn-sm" onClick={() => void copy("title")}>{copied === "title" ? <><Icon name="check" />已复制标题</> : "复制标题"}</button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void copy("text")}>{copied === "text" ? <><Icon name="check" />已复制正文</> : "复制正文"}</button>
          </div>
        </li>
        {pkg.platform === "xiaohongshu" && pkg.coverText && (
          <li>
            <div>
              <strong>保存封面图（已加封面字）</strong>
              <p className="muted small">首图铺满、封面字压在左下角，作为第一张图上传。</p>
              <div className="assist-cover">
                {pkg.images[0] && <img src={pkg.images[0].url} alt="" />}
                <CoverText text={pkg.coverText} />
              </div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => void saveCover()}>{coverSaved ? <><Icon name="check" />已保存</> : "保存封面"}</button>
          </li>
        )}
        {pkg.images.length > 0 && (
          <li>
            <div>
              <strong>保存 {pkg.images.length} 张图片</strong>
              <p className="muted small">{mobile ? "手机上如果没有自动保存，请长按下方图片选择“保存到相册”。" : "图片会下载到电脑，再上传到平台。"}</p>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => void saveAll()}>{saved === pkg.images.length && saved > 0 ? <><Icon name="check" />已保存</> : "保存图片"}</button>
          </li>
        )}
        {(pkg.openUrls.app || pkg.openUrls.web) && (
          <li>
            <div>
              <strong>打开{PLATFORM_NAME[pkg.platform]}粘贴发布</strong>
              <p className="muted small">{mobile ? "如果没有自动跳转，请手动打开 App。" : "电脑上可以使用网页端创作中心。"}</p>
            </div>
            <div className="row">
              {mobile && pkg.openUrls.app && <a className="btn btn-sm" href={pkg.openUrls.app}>打开 App</a>}
              {pkg.openUrls.web && <a className="btn btn-sm" href={pkg.openUrls.web} target="_blank" rel="noopener">打开网页端<Icon name="external" /></a>}
            </div>
          </li>
        )}
      </ol>

      {error && <Alert tone="danger">{error}</Alert>}

      <details className="assist-raw">
        <summary>查看文案与图片</summary>
        {pkg.platform === "xiaohongshu" && <p className="assist-title">{pkg.title}</p>}
        <pre className="assist-text">{pkg.text}</pre>
        <div className="assist-images">
          {pkg.images.map((im) => <img key={im.imageId} src={im.url} alt={im.caption} />)}
        </div>
      </details>

      <form
        className="assist-receipt"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onReceipt(url.trim() || undefined)) dialog.current?.close();
        }}
      >
        <label className="field">
          <span>发布后的链接（选填，总部看板会显示）</span>
          <input className="input" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>我已发布</button>
      </form>
    </dialog>
  );
}
