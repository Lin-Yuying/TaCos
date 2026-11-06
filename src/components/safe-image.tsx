"use client";
import { useState,type ImgHTMLAttributes } from "react";
import { imagePreviewUrl } from "@/lib/image-preview-url";
import { useT } from "./i18n-context";
export function SafeImage({src,...props}:ImgHTMLAttributes<HTMLImageElement>&{src:string}){
 const t=useT(),[failed,setFailed]=useState<string|null>(null),local=imagePreviewUrl(src)!==src;
 return <>{failed===src?<a className="text-small text-accent underline" href={src} download>{t("Download original")}</a>:<img {...props} src={imagePreviewUrl(src)} loading="lazy" decoding="async" onError={()=>setFailed(src)}/>}{local&&failed!==src&&<a className="mt-1 block text-caption text-faint underline" href={src} download>{t("Download original")}</a>}</>;
}
