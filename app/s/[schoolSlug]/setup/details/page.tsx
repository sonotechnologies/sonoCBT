import { Field, Input, Select } from "@/components/ui/field";
import { NIGERIAN_STATES } from "@/lib/school/defaults";
import { requireCan } from "@/lib/tenant/context";
import { saveDetailsAction } from "../actions";
import { StepForm } from "../step-shell";

const control = "h-[46px] text-[15px]";

export default async function DetailsStep({ params }: PageProps<"/s/[schoolSlug]/setup/details">) {
  const { schoolSlug } = await params;
  const { school } = await requireCan(schoolSlug, "school.manage");
  return (
    <StepForm base={`/s/${schoolSlug}/setup`} step="details" action={saveDetailsAction.bind(null, schoolSlug)}>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="School name" className="sm:col-span-2">
          <Input name="name" required defaultValue={school.name} autoComplete="organization" className={control} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input name="address" defaultValue={school.address ?? ""} autoComplete="street-address" className={control} />
        </Field>
        <Field label="Town or area" hint="Shown after your name, e.g. Greenfield Academy, Lekki">
          <Input name="locality" defaultValue={school.locality ?? ""} className={control} />
        </Field>
        <Field label="State">
          <Select name="state" defaultValue={school.state ?? ""} className={control}>
            <option value="">Choose a state</option>
            {NIGERIAN_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Phone">
          <Input name="phone" type="tel" inputMode="tel" defaultValue={school.phone ?? ""} autoComplete="tel" className={control} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={school.email ?? ""} autoComplete="email" className={control} />
        </Field>
        <Field label="Principal" className="sm:col-span-2">
          <Input name="principalName" defaultValue={school.principalName ?? ""} placeholder="e.g. Mrs. Adunni Ogundipe" className={control} />
        </Field>
      </div>
    </StepForm>
  );
}
