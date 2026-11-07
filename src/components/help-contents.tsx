"use client";

import { useEffect, useState } from "react";

// The left list of the guide. It follows the section being read in the article beside it.
export function HelpContents({ titles }: { titles: string[] }) {
  const [current, setCurrent] = useState(1);
  useEffect(() => {
    const article = document.querySelector<HTMLElement>("[data-help-article]");
    if (!article) return;
    const update = () => {
      const top = article.getBoundingClientRect().top + 32;
      let next = 1;
      article.querySelectorAll<HTMLElement>("section[id^='help-']").forEach((section, index) => {
        if (section.getBoundingClientRect().top <= top) next = index + 1;
      });
      setCurrent(next);
    };
    update();
    article.addEventListener("scroll", update, { passive: true });
    return () => article.removeEventListener("scroll", update);
  }, []);
  return (
    <>
      {titles.map((title, index) => (
        <a
          key={title}
          href={`#help-${index + 1}`}
          aria-current={current === index + 1 ? "location" : undefined}
          className={`flex min-h-7 shrink-0 items-center rounded-md px-2 text-small transition-colors hover:bg-elevated hover:text-text max-[760px]:whitespace-nowrap ${
            current === index + 1 ? "bg-active font-medium text-text" : "text-muted"
          }`}
        >
          {title}
        </a>
      ))}
    </>
  );
}
