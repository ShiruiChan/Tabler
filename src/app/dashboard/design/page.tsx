import { getProfile } from "@/lib/auth";
import { getSiteSettings } from "@/lib/site-settings";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DesignForm from "./design-form";
import AssetUploader from "./asset-uploader";

export const dynamic = "force-dynamic";

/**
 * Site Design settings page.
 *
 * Auth is enforced by the parent dashboard layout (requireRole).
 * This page additionally restricts rendering details to restaurant_owner —
 * staff land here but see a message that only owners can edit design.
 */
export default async function DesignPage() {
  const profile = await getProfile();

  if (!profile) {
    redirect("/login");
  }

  if (!profile.tenant_id) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-5">
        <p className="text-sm text-red-700">
          Your account is not associated with a restaurant. Contact support.
        </p>
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Site Design</h1>
        <p className="mt-1 text-sm text-gray-500">
          Customise how your restaurant appears to visitors online.
        </p>
      </div>

      {/* Read-only domain info */}
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Domain
        </h2>
        <dl className="space-y-3">
          <div className="flex gap-4">
            <dt className="w-36 shrink-0 text-sm font-medium text-gray-500">
              Slug URL
            </dt>
            <dd className="text-sm text-gray-900">
              {tenant?.slug
                ? `https://${tenant.slug}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000"}`
                : "—"}
            </dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-36 shrink-0 text-sm font-medium text-gray-500">
              Custom domain
            </dt>
            <dd className="text-sm text-gray-900">
              {tenant?.custom_domain ?? (
                <span className="text-gray-400">
                  Not configured.{" "}
                  <a
                    href="mailto:support@tabler.example.com"
                    className="text-blue-600 underline hover:text-blue-800"
                  >
                    Contact support
                  </a>{" "}
                  to set up a custom domain.
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {!isOwner ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-6 py-5">
          <p className="text-sm text-yellow-800">
            Only the restaurant owner can edit site design settings. Contact
            your owner to make changes.
          </p>
        </div>
      ) : (
        <>
          {/* Asset uploads */}
          <section className="rounded-lg border border-gray-200 bg-white px-6 py-5">
            <h2 className="mb-4 text-base font-semibold text-gray-900">
              Images
            </h2>
            <AssetUploader
              tenantId={profile.tenant_id}
              currentLogoUrl={settings?.logo_url ?? null}
              currentHeroUrl={settings?.hero_image_url ?? null}
            />
          </section>

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
  );
}
