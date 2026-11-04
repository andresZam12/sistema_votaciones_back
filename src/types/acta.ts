import { z } from 'zod';

// Esquema Zod estricto para la recepción de actas E-14
export const ActaInputSchema = z.object({
  acta: z.string().min(3), // ej: "E14-176-0042-03"
  mesa: z.number().int().positive(),
  puesto: z.number().int().positive(),
  municipio: z.number().int().positive(),
  version: z.number().int().positive(),
  jurado: z.string().min(1),
  ts_cierre: z.number().int().positive(),
  votos: z.record(z.string(), z.number().int().nonnegative()),
  sufragantes: z.number().int().nonnegative(),
  hash_foto: z.string().min(4),
  idem: z.string().min(8) // clave de idempotencia del envío
});

export type ActaInput = z.infer<typeof ActaInputSchema>;

// Regla contable electoral: suma de todos los votos (candidatos + blanco + nulo + no marcados) = sufragantes
export function esActaDudosa(acta: ActaInput): boolean {
  const sumaVotos = Object.values(acta.votos).reduce((acc, v) => acc + v, 0);
  return sumaVotos !== acta.sufragantes;
}
