export const text = (value) => RegExp.escape(value);
const titlePattern = (title) => new RegExp(`^${text(title)}(?:[ *]|$)`);
function nodeSchema(node, rootSchema) {
  if (node.$ref)
    return {
      ...nodeSchema(rootSchema.$defs[node.$ref.split("/").pop()], rootSchema),
      ...Object.fromEntries(
        Object.entries(node).filter(([key]) => key !== "$ref"),
      ),
    };
  if (node.anyOf) {
    const options = node.anyOf.filter((s) => s.type !== "null");
    return {
      ...nodeSchema(
        options.find((s) => s.type === "string") ?? options[0],
        rootSchema,
      ),
      ...Object.fromEntries(
        Object.entries(node).filter(([key]) => key !== "anyOf"),
      ),
    };
  }
  return node;
}
export async function setValues(
  scope,
  schema,
  value,
  rootSchema = schema,
  page = scope,
) {
  for (const [key, data] of Object.entries(value)) {
    if (["uid", "revision", "document_type"].includes(key) || data == null)
      continue;
    const original = schema.properties?.[key];
    if (!original) continue;
    const field = nodeSchema(original, rootSchema);
    const title = original.title ?? field.title ?? key;
    if (field.type === "object" || field.properties) {
      const add = scope.getByRole("button", {
        name: `Add ${title.toLowerCase()}`,
        exact: true,
      });
      if (await add.count()) await add.click();
      await setValues(
        scope.getByRole("group", { name: titlePattern(title) }),
        field,
        data,
        rootSchema,
        page,
      );
    } else if (field.type === "array") {
      const group = scope.getByRole("group", { name: titlePattern(title) });
      for (let index = 0; index < data.length; index++) {
        await group
          .getByRole("button", {
            name: `Add ${title.toLowerCase()} item`,
            exact: true,
          })
          .click();
        const item = nodeSchema(field.items, rootSchema);
        if (item.type === "object" || item.properties)
          await setValues(
            group.getByRole("group", {
              name: titlePattern(item.title ?? `${title} ${index + 1}`),
            }),
            item,
            data[index],
            rootSchema,
            page,
          );
        else
          await group
            .getByLabel(titlePattern(item.title ?? `${title} ${index + 1}`))
            .fill(String(data[index]));
      }
    } else if (field.enum || field.type === "boolean") {
      await scope.getByLabel(titlePattern(title)).click();
      const label =
        typeof data === "boolean"
          ? data
            ? "Yes"
            : "No"
          : String(data)
              .replaceAll("_", " ")
              .replace(/^./, (c) => c.toUpperCase());
      await page.getByRole("option", { name: label, exact: true }).click();
    } else await scope.getByLabel(titlePattern(title)).fill(String(data));
  }
}
