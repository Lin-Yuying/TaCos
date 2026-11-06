export function imagePreviewUrl(src:string){return /^\/api\/files\/[\w-]+$/.test(src)?`${src}?preview=1`:src;}
