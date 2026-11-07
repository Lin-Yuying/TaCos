import { Suspense } from "react";
import { connection } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { I18nProvider } from "@/components/i18n-context";
import { NotFoundText } from "@/components/not-found-text";
import { resolveLocale } from "@/lib/locale";
import { GATE } from "@/lib/page-chrome";

export default function NotFound() {
  return (
    <div className={GATE}>
      <Suspense fallback={null}>
        <NotFoundView />
      </Suspense>
    </div>
  );
}

async function NotFoundView() {
  await connection();
  const user = await getSessionUser();
  return (
    <I18nProvider locale={await resolveLocale(user)}>
      <NotFoundText />
    </I18nProvider>
  );
}
