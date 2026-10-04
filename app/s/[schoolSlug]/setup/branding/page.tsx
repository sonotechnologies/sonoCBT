import { BRAND_SWATCHES } from "@/lib/school/defaults";
import { requireCan } from "@/lib/tenant/context";
import { saveBrandingAction } from "../actions";
import { StepForm } from "../step-shell";
import { BrandingFields } from "./branding-fields";

export default async function BrandingStep({ params }: PageProps<"/s/[schoolSlug]/setup/branding">) {
  const { schoolSlug } = await params;
  const { school } = await requireCan(schoolSlug, "school.manage");
  return (
    <StepForm
      base={`/s/${schoolSlug}/setup`}
      step="branding"
      action={saveBrandingAction.bind(null, schoolSlug)}
    >
      <BrandingFields
        schoolName={school.name}
        locality={school.locality}
        motto={school.motto ?? ""}
        brandColor={school.brandColor ?? BRAND_SWATCHES[0]}
        logoUrl={school.logoUrl}
        signatureUrl={school.principalSignatureUrl}
        principalName={school.principalName}
      />
    </StepForm>
  );
}
