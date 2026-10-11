import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import { Sc3dError } from "./errors.mjs";
import { validateAndLowerSc3d, CORE_CAPABILITIES } from "./semantic.mjs";

const schemaPath = fileURLToPath(new URL("./schema-v0.1.json", import.meta.url));
let compiledValidator = null;

async function schemaValidator() {
  if (compiledValidator) return compiledValidator;
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  compiledValidator = ajv.compile(schema);
  return compiledValidator;
}

function formatAjvErrors(errors = []) {
  return errors
    .slice(0, 12)
    .map((error) => {
      const location = error.instancePath || "$";
      return `${location} ${error.message ?? "schema violation"}`;
    })
    .join("; ");
}

export async function parseSc3dText(text, {
  source = "<memory>",
  supportedCapabilities = CORE_CAPABILITIES,
} = {}) {
  let document;
  try {
    document = YAML.parse(text, { prettyErrors: true });
  } catch (error) {
    throw new Sc3dError("SC3D-Y001", `${source}: ${error.message}`, "$");
  }

  const validate = await schemaValidator();
  if (!validate(document)) {
    throw new Sc3dError(
      "SC3D-S101",
      `${source}: ${formatAjvErrors(validate.errors)}`,
      "$",
    );
  }

  return validateAndLowerSc3d(document, { supportedCapabilities });
}

export async function loadSc3dFile(filePath, options = {}) {
  const text = await readFile(filePath, "utf8");
  return parseSc3dText(text, { ...options, source: filePath });
}
