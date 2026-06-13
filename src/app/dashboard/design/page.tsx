import { getProfile } from "@/lib/auth";
import { getSiteSettings } from "@/lib/site-settings";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DesignForm from "./design-form";
import AssetUploader from "./asset-uploader";
import { PageHeader, PanelCard } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Site Design settings page.
 *
 * Auth is enforced by the parent dashboard layout (requireRole).
 * This page additionally restricts rendering details to restaurant_owner -
 * staff land here but see a message that only owners can edit design.
 */
export default async function DesignPage() {
  const profile = await getProfile();

  if (!profile) {
    redirect("/login");
  }

  if (!profile.tenant_id) {
    return (
      <div className="alert-error">
        Ваш аккаунт не привязан к ресторану. Обратитесь в поддержку.
      </div>
    );
  }

  // Fetch site settings and tenant info in parallel.
  const supabase = createClient();
  const [settings, tenantResult] = await Promise.all([
    getSiteSettings(profile.tenant_id),
    supabase
      .from("tenants")
      .select("name, slug, custom_domain, status")
      .eq("id", profile.tenant_id)
      .single(),
  ]);

  const tenant = tenantResult.data;

  const isOwner = profile.role === "restaurant_owner";

  return (
    <div>
      <PageHeader
        eyebrow="Дизайн сайта"
        title="Внешний вид сайта"
        description="Настройте, как ваш ресторан выглядит для гостей в интернете."
      />

      <div className="space-y-8">
        {/* Read-only domain info */}
        <PanelCard title="Домен">
          <dl className="space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
              <dt className="w-36 shrink-0 text-sm font-medium text-slate-500">
                Адрес сайта
              </dt>
              <dd className="min-w-0 break-all text-sm text-slate-100">
                {tenant?.slug
                  ? `https://${tenant.slug}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000"}`
                  : "-"}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
              <dt className="w-36 shrink-0 text-sm font-medium text-slate-500">
                Свой домен
              </dt>
              <dd className="text-sm text-slate-100">
                {tenant?.custom_domain ?? (
                  <span className="text-slate-500">
                    Не настроен.{" "}
                    <a
                      href="mailto:support@tabler.example.com"
                      className="text-amber-400 transition-colors hover:text-amber-300"
                    >
                      Напишите в поддержку
                    </a>
                    , чтобы подключить свой домен.
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </PanelCard>

        {!isOwner ? (
          <div className="alert-error">
            Редактировать дизайн сайта может только владелец ресторана.
            Обратитесь к владельцу, чтобы внести изменения.
          </div>
        ) : (
          <>
            {/* Asset uploads */}
            <PanelCard title="Изображения">
              <AssetUploader
                tenantId={profile.tenant_id}
                currentLogoUrl={settings?.logo_url ?? null}
                currentHeroUrl={settings?.hero_image_url ?? null}
              />
            </PanelCard>

            {/* Design form */}
            <DesignForm
              initialValues={{
                primary_color: settings?.primary_color ?? "#1a1a1a",
                secondary_color: settings?.secondary_color ?? "#f5f5f5",
                accent_color: settings?.accent_color ?? "#e11d48",
                font_heading: settings?.font_heading ?? "Inter",
                font_body: settings?.font_body ?? "Inter",
                tagline: settings?.tagline ?? "",
                about: settings?.about ?? "",
                instagram: settings?.social?.instagram ?? "",
                facebook: settings?.social?.facebook ?? "",
                x: settings?.social?.x ?? "",
                tiktok: settings?.social?.tiktok ?? "",
                website: settings?.social?.website ?? "",
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
