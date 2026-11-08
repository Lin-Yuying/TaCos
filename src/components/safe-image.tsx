"use client";
import { useState,type ImgHTMLAttributes } from "react";
import { imagePreviewUrl } from "@/lib/image-preview-url";
import { useT } from "./i18n-context";
// Shows the small preview. Only when the preview cannot load does a "Download original" link
// stand in for the picture.
export function SafeImage({src,...props}:ImgHTMLAttributes<HTMLImageElement>&{src:string}){
 const t=useT(),[failed,setFailed]=useState<string|null>(null);
 return failed===src?<a className="text-small text-accent underline" href={src} download>{t("Download original")}</a>:<img {...props} src={imagePreviewUrl(src)} loading="lazy" decoding="async" onError={()=>setFailed(src)}/>;
}
