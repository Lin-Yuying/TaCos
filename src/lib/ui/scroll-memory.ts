"use client";
import { useEffect, type RefObject } from "react";
import { useUI } from "@/components/ui-context";
export function useScrollMemory(
  root: RefObject<HTMLElement | null>,
  identity: string,
  selector?: string,
  ready = true,
) {
  const { scope } = useUI();
  useEffect(() => {
    if (!ready) return;
    const element = selector
      ? root.current?.querySelector<HTMLElement>(selector)
      : root.current;
    if (!element) return;
    const key = `tacos.scroll.${scope}.${identity}`;
    let desired = 0;
    try {
      desired = Number(localStorage.getItem(key) ?? 0);
    } catch {}
    let initialized = false;
    const restore = () => {
      if (initialized) return;
      element.scrollTop = desired;
      if (element.scrollHeight - element.clientHeight >= desired)
        initialized = true;
    };
    const frame = requestAnimationFrame(restore);
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      try {
        localStorage.setItem(key, String(element.scrollTop));
      } catch {}
    };
    const scroll = () => {
      if (!initialized) return;
      clearTimeout(timer);
      timer = setTimeout(save, 120);
    };
    const interact = () => {
      initialized = true;
    };
    element.addEventListener("scroll", scroll);
    element.addEventListener("wheel", interact, { passive: true });
    element.addEventListener("pointerdown", interact);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clearTimeout(timer);
      if (initialized) save();
      element.removeEventListener("scroll", scroll);
      element.removeEventListener("wheel", interact);
      element.removeEventListener("pointerdown", interact);
    };
  }, [scope, identity, root, selector, ready]);
}
