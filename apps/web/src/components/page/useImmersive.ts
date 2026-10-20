import { useEffect, useState, type RefObject } from "react";

/**
 * 体验页的滚动效果：
 * - 带 data-reveal 的元素进入视野时加上 is-in（淡入上移，见 page.css）；只触发一次。
 * - 带 data-section 的版块：记录当前停在哪一屏（进度条高亮）、是否已经滚过开场（顶栏变实色）。
 * 只用 IntersectionObserver，不做滚动监听；系统开了“减少动态效果”时 CSS 里直接显示，不做动画。
 * key 变化（页面内容更新）时重新登记元素。
 */
export function useImmersive(root: RefObject<HTMLElement | null>, key: string) {
  const [active, setActive] = useState<string | null>(null);
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    el.classList.add("can-reveal");

    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          reveal.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    el.querySelectorAll("[data-reveal]:not(.is-in)").forEach((n) => reveal.observe(n));

    // 视口中间那条线落在哪个版块，哪个版块就是“当前”
    const sections = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -54% 0px" },
    );
    el.querySelectorAll("[data-section]").forEach((n) => sections.observe(n));

    const hero = el.querySelector("[data-hero]");
    const heroWatch = new IntersectionObserver(([e]) => setPastHero(!e?.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    if (hero) heroWatch.observe(hero);

    return () => {
      reveal.disconnect();
      sections.disconnect();
      heroWatch.disconnect();
    };
  }, [root, key]);

  return { active, pastHero };
}
