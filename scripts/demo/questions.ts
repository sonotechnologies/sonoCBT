/**
 * The demo school's question bank (~600 questions), generated
 * deterministically: parametric maths/science templates (so every number is
 * worked out, never typed) plus short fact tables for the other subjects.
 * Options use $…$ for maths, as the editor stores it.
 */

export type Level = "JSS1" | "JSS2" | "JSS3" | "SS1" | "SS2" | "SS3";
export type Diff = "easy" | "medium" | "hard";
export type GenQ = {
  subject: string;
  level: Level;
  topic: string;
  difficulty: Diff;
  stem: string;
  options: string[];
  correct: number;
  /** The wrong option most students fall for (index), for the answer simulation. */
  trap: number;
  image?: "hexagon" | "right-triangle" | "bar-chart";
};
export type TheoryQ = { subject: string; level: Level; topic: string; stem: string; marks: number; guide: string };

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}
const rand = prng(2027);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const frac = (n: number, d: number) => {
  const g = gcd(n, d);
  const [a, b] = [n / g, d / g];
  return b === 1 ? `$${a}$` : `$\\frac{${a}}{${b}}$`;
};
const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** Puts the right answer among the distractors at a stable position; the first distractor is the trap. */
function mk(subject: string, level: Level, topic: string, difficulty: Diff, stem: string, right: string, wrong: string[]): GenQ | null {
  const ws = [...new Set(wrong.filter((w) => w !== right))].slice(0, 3);
  if (ws.length < 3) return null;
  const at = int(0, 3);
  const options = [...ws];
  options.splice(at, 0, right);
  return { subject, level, topic, difficulty, stem, options, correct: at, trap: options.indexOf(ws[0]) };
}

const JSS: Level[] = ["JSS1", "JSS2", "JSS3"];
const SS: Level[] = ["SS1", "SS2", "SS3"];
const pick = <T>(xs: T[]) => xs[int(0, xs.length - 1)];

function repeat(n: number, make: () => GenQ | null, out: GenQ[]) {
  const seen = new Set(out.map((q) => q.stem));
  for (let tries = 0, made = 0; made < n && tries < n * 20; tries++) {
    const q = make();
    if (q && !seen.has(q.stem)) {
      seen.add(q.stem);
      out.push(q);
      made++;
    }
  }
}

// ─── Mathematics ─────────────────────────────────────────────────────────────

function maths(): GenQ[] {
  const out: GenQ[] = [];
  const M = "Mathematics";
  repeat(24, () => {
    const [b, d] = [int(2, 9), int(2, 9)];
    const [a, c] = [int(1, b - 1 || 1), int(1, d - 1 || 1)];
    if (b === d) return null;
    return mk(M, pick(JSS), "Fractions", "easy", `Simplify $\\frac{${a}}{${b}} + \\frac{${c}}{${d}}$.`, frac(a * d + c * b, b * d), [frac(a + c, b + d), frac(a * c, b * d), frac(a * d + c * b, b + d), frac(a + c, b * d)]);
  }, out);
  repeat(16, () => {
    const [a, b] = [int(2, 9), int(2, 9)];
    const v = pick(["x", "a", "y", "p"]);
    return mk(M, pick(JSS), "Indices", "easy", `Simplify $${v}^{${a}} \\times ${v}^{${b}}$.`, `$${v}^{${a + b}}$`, [`$${v}^{${a * b}}$`, `$${v}^{${Math.abs(a - b)}}$`, `$2${v}^{${a + b}}$`]);
  }, out);
  repeat(12, () => {
    const [a, m] = [int(2, 5), int(2, 4)];
    return mk(M, pick(JSS), "Indices", "medium", `Evaluate $${a}^{${m}}$.`, String(a ** m), [String(a * m), String(a ** (m - 1)), String(a + m), String((a + 1) ** m)]);
  }, out);
  repeat(26, () => {
    const [a, x] = [int(2, 9), int(1, 12)];
    const b = int(1, 20);
    const c = a * x + b;
    return mk(M, pick(JSS), "Simple equations", "easy", `Solve for $x$: $${a}x + ${b} = ${c}$.`, `$x = ${x}$`, [`$x = ${fmt((c + b) / a)}$`, `$x = ${c - b}$`, `$x = ${x + 1}$`, `$x = ${fmt(c / a)}$`]);
  }, out);
  repeat(16, () => {
    const p = pick([5, 10, 12, 15, 20, 25, 30, 40, 75]);
    const n = int(2, 40) * 20;
    return mk(M, pick(JSS), "Percentages", "easy", `What is ${p}% of ${naira(n)}?`, naira((p * n) / 100), [naira(n - (p * n) / 100), naira(p * n), naira((p * n) / 10), naira(n / p)]);
  }, out);
  repeat(14, () => {
    const xs = Array.from({ length: 5 }, () => int(2, 20));
    const sum = xs.reduce((a, b) => a + b, 0);
    if (sum % 5) return null;
    return mk(M, pick(JSS), "Statistics", "easy", `Find the mean of ${xs.join(", ")}.`, String(sum / 5), [String(sum), String([...xs].sort((a, b) => a - b)[2]), String(sum / 4), String(Math.max(...xs) - Math.min(...xs))]);
  }, out);
  repeat(14, () => {
    const [p, q] = [int(25, 80), int(25, 80)];
    if (p + q >= 170) return null;
    return mk(M, pick(JSS), "Angles", "easy", `Two angles of a triangle are $${p}^{\\circ}$ and $${q}^{\\circ}$. Find the third angle.`, `$${180 - p - q}^{\\circ}$`, [`$${360 - p - q}^{\\circ}$`, `$${p + q}^{\\circ}$`, `$${90 - Math.min(p, q)}^{\\circ}$`, `$${180 - p}^{\\circ}$`]);
  }, out);
  repeat(14, () => {
    const [l, w] = [int(3, 20), int(2, 15)];
    return mk(M, pick(JSS), "Mensuration", "easy", `A rectangle is ${l} cm long and ${w} cm wide. What is its area?`, `$${l * w}\\text{ cm}^{2}$`, [`$${2 * (l + w)}\\text{ cm}^{2}$`, `$${l + w}\\text{ cm}^{2}$`, `$${(l * w) / 2}\\text{ cm}^{2}$`]);
  }, out);
  repeat(12, () => {
    const [b, h] = [int(2, 12) * 2, int(3, 15)];
    return mk(M, pick(JSS), "Mensuration", "medium", `A triangle has base ${b} cm and height ${h} cm. Find its area.`, `$${(b * h) / 2}\\text{ cm}^{2}$`, [`$${b * h}\\text{ cm}^{2}$`, `$${b + h}\\text{ cm}^{2}$`, `$${(b + h) / 2}\\text{ cm}^{2}$`]);
  }, out);
  repeat(14, () => {
    const n = int(9, 63);
    const right = n.toString(2);
    return mk(M, pick(["JSS2", "JSS3", "SS1"] as Level[]), "Number bases", "medium", `Convert $${n}_{10}$ to base two.`, `$${right}_{2}$`, [`$${(n + 1).toString(2)}_{2}$`, `$${[...right].reverse().join("")}_{2}$`, `$${(n - 1).toString(2)}_{2}$`, `$${(n * 2).toString(2)}_{2}$`]);
  }, out);
  repeat(12, () => {
    const d = int(2, 9);
    const e = int(3, 6);
    const n = `0.${"0".repeat(e - 1)}${d}${int(1, 9)}`;
    const m = Number(n) * 10 ** e;
    return mk(M, pick(["JSS3", "SS1"] as Level[]), "Standard form", "medium", `Express ${n} in standard form.`, `$${fmt(m)} \\times 10^{-${e}}$`, [`$${fmt(m)} \\times 10^{${e}}$`, `$${fmt(m * 10)} \\times 10^{-${e + 1}}$`, `$${fmt(m)} \\times 10^{-${e - 1}}$`]);
  }, out);
  repeat(14, () => {
    const [r, s] = [int(1, 9), int(1, 9)];
    if (r === s) return null;
    const [p, q] = [-(r + s), r * s];
    const poly = `x^{2} ${p < 0 ? "-" : "+"} ${Math.abs(p)}x + ${q}`;
    return mk(M, pick(SS), "Quadratic equations", "medium", `Solve $${poly} = 0$.`, `$x = ${Math.min(r, s)}$ or $x = ${Math.max(r, s)}$`, [`$x = -${Math.min(r, s)}$ or $x = -${Math.max(r, s)}$`, `$x = ${r + s}$ or $x = ${q}$`, `$x = ${Math.min(r, s)}$ or $x = -${Math.max(r, s)}$`]);
  }, out);
  repeat(12, () => {
    const [a, n] = [pick([2, 3, 5, 10]), int(2, 5)];
    return mk(M, pick(SS), "Logarithms", "hard", `Evaluate $\\log_{${a}} ${a ** n}$.`, String(n), [String(a ** (n - 1)), String(n + 1), String(a * n), String(fmt((a ** n) / a))]);
  }, out);
  repeat(14, () => {
    const [P, R, T] = [int(2, 20) * 5000, pick([5, 8, 10, 12, 15]), int(2, 5)];
    return mk(M, pick(SS), "Simple interest", "medium", `Find the simple interest on ${naira(P)} at ${R}% per annum for ${T} years.`, naira((P * R * T) / 100), [naira((P * R) / 100), naira(P + (P * R * T) / 100), naira((P * T) / 100), naira((P * R * T) / 10)]);
  }, out);
  repeat(12, () => {
    const [red, blue] = [int(2, 9), int(2, 9)];
    const total = red + blue;
    return mk(M, pick(SS), "Probability", "medium", `A bag holds ${red} red and ${blue} blue balls. A ball is picked at random. What is the probability that it is red?`, frac(red, total), [frac(red, blue), frac(blue, total), frac(1, total), frac(red, total + 1)]);
  }, out);
  repeat(12, () => {
    const [x, y] = [int(1, 9), int(1, 9)];
    return mk(M, pick(SS), "Simultaneous equations", "hard", `Solve $x + y = ${x + y}$ and $x - y = ${x - y}$.`, `$x = ${x}, y = ${y}$`, [`$x = ${y}, y = ${x}$`, `$x = ${x + y}, y = ${x - y}$`, `$x = ${x + 1}, y = ${y - 1}$`]);
  }, out);
  repeat(10, () => {
    const [a, b] = [int(2, 9), int(2, 9)];
    const total = int(2, 12) * (a + b) * 100;
    return mk(M, pick(JSS), "Ratio", "medium", `Share ${naira(total)} between Ade and Bisi in the ratio ${a} : ${b}. How much does Ade get?`, naira((total * a) / (a + b)), [naira((total * b) / (a + b)), naira(total / a), naira(total / (a + b)), naira((total * a) / b)]);
  }, out);
  // Questions with a diagram.
  out.push(
    { subject: M, level: "JSS1", topic: "Shapes", difficulty: "easy", stem: "How many sides does the shape in the diagram have?", options: ["5", "6", "7", "8"], correct: 1, trap: 0, image: "hexagon" },
    { subject: M, level: "JSS2", topic: "Shapes", difficulty: "easy", stem: "What type of triangle is shown in the diagram?", options: ["Equilateral", "Right-angled", "Isosceles", "Obtuse-angled"], correct: 1, trap: 2, image: "right-triangle" },
    { subject: M, level: "JSS3", topic: "Statistics", difficulty: "medium", stem: "The bar chart shows books read by five students. How many bars are taller than the yellow bar?", options: ["0", "1", "2", "3"], correct: 1, trap: 2, image: "bar-chart" },
  );
  return out;
}

// ─── Sciences (parametric) ───────────────────────────────────────────────────

function physics(): GenQ[] {
  const out: GenQ[] = [];
  const P = "Physics";
  repeat(12, () => {
    const [v, t] = [int(2, 30), int(2, 20)];
    return mk(P, pick(SS), "Motion", "easy", `A car travels ${v * t} m in ${t} s. What is its average speed?`, `$${v}\\text{ m/s}$`, [`$${v * t * t}\\text{ m/s}$`, `$${fmt(t / (v * t))}\\text{ m/s}$`, `$${v * t + t}\\text{ m/s}$`]);
  }, out);
  repeat(10, () => {
    const [d, V] = [int(2, 12), int(2, 10)];
    return mk(P, pick(SS), "Density", "medium", `A block of mass ${d * V} g has a volume of ${V} $\\text{cm}^{3}$. Find its density.`, `$${d}\\text{ g/cm}^{3}$`, [`$${d * V * V}\\text{ g/cm}^{3}$`, `$${fmt(V / (d * V))}\\text{ g/cm}^{3}$`, `$${d * V + V}\\text{ g/cm}^{3}$`]);
  }, out);
  repeat(10, () => {
    const [I, R] = [int(1, 5), int(2, 12)];
    return mk(P, pick(SS), "Electricity", "medium", `A current of ${I} A flows through a ${R} Ω resistor. What is the p.d. across it?`, `${I * R} V`, [`${fmt(R / I)} V`, `${I + R} V`, `${fmt(I / R)} V`]);
  }, out);
  repeat(10, () => {
    const [F, d] = [int(5, 50), int(2, 10)];
    return mk(P, pick(SS), "Work and energy", "easy", `A force of ${F} N moves a load ${d} m along its direction. How much work is done?`, `${F * d} J`, [`${F + d} J`, `${fmt(F / d)} J`, `${F * d * 10} J`]);
  }, out);
  repeat(8, () => {
    const [m, v] = [int(1, 10), int(2, 10)];
    return mk(P, pick(SS), "Work and energy", "hard", `Find the kinetic energy of a ${m} kg body moving at ${v} m/s.`, `${(m * v * v) / 2} J`, [`${m * v * v} J`, `${m * v} J`, `${(m * v) / 2} J`]);
  }, out);
  repeat(8, () => {
    const [p, A] = [int(2, 20) * 10, int(2, 10)];
    return mk(P, pick(SS), "Pressure", "medium", `A force of ${p * A} N acts on an area of ${A} $\\text{m}^{2}$. What is the pressure?`, `${p} Pa`, [`${p * A * A} Pa`, `${p * A + A} Pa`, `${fmt(A / (p * A))} Pa`]);
  }, out);
  repeat(8, () => {
    const m = int(2, 60);
    return mk(P, pick(SS), "Forces", "easy", `What is the weight of a ${m} kg mass? (Take $g = 10\\text{ m/s}^{2}$.)`, `${m * 10} N`, [`${m} N`, `${m + 10} N`, `${fmt(m / 10)} N`]);
  }, out);
  return out;
}

const ATOMS: [string, string, number, number][] = [
  ["Hydrogen", "H", 1, 1],
  ["Carbon", "C", 6, 12],
  ["Nitrogen", "N", 7, 14],
  ["Oxygen", "O", 8, 16],
  ["Sodium", "Na", 11, 23],
  ["Magnesium", "Mg", 12, 24],
  ["Aluminium", "Al", 13, 27],
  ["Sulphur", "S", 16, 32],
  ["Chlorine", "Cl", 17, 35.5],
  ["Potassium", "K", 19, 39],
  ["Calcium", "Ca", 20, 40],
  ["Iron", "Fe", 26, 56],
  ["Copper", "Cu", 29, 64],
  ["Zinc", "Zn", 30, 65],
];
const COMPOUNDS: [string, string, number][] = [
  ["water", "\\ce{H2O}", 18],
  ["carbon(IV) oxide", "\\ce{CO2}", 44],
  ["sodium chloride", "\\ce{NaCl}", 58.5],
  ["sulphuric(VI) acid", "\\ce{H2SO4}", 98],
  ["calcium trioxocarbonate(IV)", "\\ce{CaCO3}", 100],
  ["ammonia", "\\ce{NH3}", 17],
  ["methane", "\\ce{CH4}", 16],
  ["hydrogen chloride", "\\ce{HCl}", 36.5],
  ["sodium hydroxide", "\\ce{NaOH}", 40],
  ["magnesium oxide", "\\ce{MgO}", 40],
];

function chemistry(): GenQ[] {
  const out: GenQ[] = [];
  const C = "Chemistry";
  for (const [name, sym] of ATOMS) {
    const others = ATOMS.filter((a) => a[1] !== sym).map((a) => a[1]);
    const q = mk(C, "SS1", "Symbols and formulae", "easy", `What is the chemical symbol of ${name.toLowerCase()}?`, sym, [sym === "K" ? "P" : sym === "Na" ? "So" : `${name[0]}${name[2] ?? ""}`, pick(others), pick(others), pick(others)]);
    if (q) out.push(q);
  }
  for (const [name, , z] of ATOMS) {
    const q = mk(C, "SS1", "Atomic structure", "easy", `How many protons are in an atom of ${name.toLowerCase()}?`, String(z), [String(z * 2), String(z + 1), String(z - 1), String(z + 2)]);
    if (q) out.push(q);
  }
  for (const [name, f, mr] of COMPOUNDS) {
    const q = mk(C, pick(SS), "Mole concept", "medium", `Using H = 1, C = 12, N = 14, O = 16, Na = 23, Mg = 24, S = 32, Cl = 35.5, Ca = 40, find the relative molecular mass of ${name}, $${f}$.`, fmt(mr), [fmt(mr - 1), fmt(mr + 16), fmt(mr * 2), fmt(mr - 16)]);
    if (q) out.push(q);
  }
  repeat(10, () => {
    const [name, f, mr] = pick(COMPOUNDS);
    const n = int(2, 5);
    return mk(C, pick(SS), "Mole concept", "hard", `How many moles are in ${fmt(mr * n)} g of $${f}$ (${name}, $M_r = ${fmt(mr)}$)?`, `${n} mol`, [`${n + 1} mol`, `${fmt(mr * n * mr)} mol`, `${fmt(1 / n)} mol`, `${n * 2} mol`]);
  }, out);
  const facts: Fact[] = [
    ["Which of these is a mixture?", "Air", "Oxygen", "Sodium chloride", "Distilled water", "Matter"],
    ["The process by which a solid changes directly to gas is", "sublimation", "evaporation", "condensation", "melting", "States of matter"],
    ["An acid turns blue litmus paper", "red", "blue", "green", "colourless", "Acids and bases"],
    ["Which gas turns lime water milky?", "Carbon(IV) oxide", "Oxygen", "Hydrogen", "Nitrogen", "Gases"],
    ["The pH of a neutral solution at room temperature is", "7", "0", "14", "1", "Acids and bases"],
    ["Which separation method is best for getting salt from salt solution?", "Evaporation", "Filtration", "Decantation", "Sieving", "Separation techniques"],
    ["Rusting of iron needs", "water and oxygen", "water only", "oxygen only", "carbon(IV) oxide", "Chemical change"],
    ["The noble gases are found in group", "0 (18)", "1", "2", "7", "Periodic table"],
  ];
  out.push(...facts.map((f) => fact(C, "SS2", f)).filter((x): x is GenQ => !!x));
  return out;
}

// ─── Fact tables ─────────────────────────────────────────────────────────────

/** [stem, right answer, trap, other, other, topic] */
type Fact = [string, string, string, string, string, string];
function fact(subject: string, level: Level, [stem, right, trap, b, c, topic]: Fact, difficulty: Diff = "easy"): GenQ | null {
  return mk(subject, level, topic, difficulty, stem, right, [trap, b, c]);
}
function facts(subject: string, levels: Level[], rows: Fact[]): GenQ[] {
  return rows.map((r, i) => fact(subject, levels[i % levels.length], r, i % 4 === 3 ? "medium" : "easy")).filter((x): x is GenQ => !!x);
}

const BIOLOGY: Fact[] = [
  ["The basic unit of life is the", "cell", "tissue", "organ", "atom", "Cell biology"],
  ["Which organelle is the site of aerobic respiration?", "Mitochondrion", "Nucleus", "Ribosome", "Chloroplast", "Cell biology"],
  ["Green plants make food by", "photosynthesis", "respiration", "transpiration", "digestion", "Nutrition"],
  ["The pigment that traps light in plants is", "chlorophyll", "haemoglobin", "melanin", "carotene", "Nutrition"],
  ["Malaria is caused by", "Plasmodium", "the Anopheles mosquito", "a virus", "bacteria", "Health"],
  ["Which blood cells fight infection?", "White blood cells", "Red blood cells", "Platelets", "Plasma", "Transport"],
  ["The largest organ in the human body is the", "skin", "liver", "heart", "brain", "Human body"],
  ["Loss of water vapour from leaves is", "transpiration", "guttation", "respiration", "osmosis", "Transport"],
  ["The movement of water across a membrane from dilute to concentrated solution is", "osmosis", "diffusion", "active transport", "plasmolysis", "Cell biology"],
  ["Which part of the flower becomes the fruit?", "Ovary", "Ovule", "Petal", "Anther", "Reproduction"],
  ["Insulin is produced by the", "pancreas", "liver", "kidney", "stomach", "Coordination"],
  ["The functional unit of the kidney is the", "nephron", "neuron", "alveolus", "villus", "Excretion"],
  ["Gas exchange in the lungs takes place in the", "alveoli", "bronchi", "trachea", "larynx", "Respiration"],
  ["An organism that makes its own food is a", "producer", "consumer", "decomposer", "parasite", "Ecology"],
  ["Which vitamin deficiency causes scurvy?", "Vitamin C", "Vitamin A", "Vitamin D", "Vitamin K", "Nutrition"],
  ["The study of heredity is", "genetics", "ecology", "taxonomy", "cytology", "Genetics"],
  ["Which carries genetic information?", "DNA", "ATP", "Glucose", "Starch", "Genetics"],
  ["Fungi that feed on dead matter are", "saprophytes", "parasites", "producers", "predators", "Ecology"],
  ["The red pigment in blood that carries oxygen is", "haemoglobin", "chlorophyll", "fibrinogen", "plasma", "Transport"],
  ["Which of these is a vector of sleeping sickness?", "Tsetse fly", "Housefly", "Female Anopheles mosquito", "Blackfly", "Health"],
  ["The part of the brain that controls balance is the", "cerebellum", "cerebrum", "medulla", "hypothalamus", "Coordination"],
  ["Enzymes are", "proteins", "fats", "vitamins", "minerals", "Nutrition"],
  ["Pollination by wind is common in", "grasses", "hibiscus", "pride of Barbados", "flamboyant", "Reproduction"],
  ["The xylem transports", "water and mineral salts", "food", "hormones", "oxygen only", "Transport"],
  ["A group of similar cells performing a function is a", "tissue", "organ", "system", "organism", "Cell biology"],
  ["Which is an example of a mammal?", "Bat", "Lizard", "Frog", "Shark", "Classification"],
  ["Bile is stored in the", "gall bladder", "liver", "pancreas", "duodenum", "Nutrition"],
  ["Sickle cell anaemia is", "inherited", "caused by mosquitoes", "caused by poor diet", "infectious", "Genetics"],
  ["The energy currency of the cell is", "ATP", "DNA", "glucose", "oxygen", "Cell biology"],
  ["Which of these is not a living thing?", "Stone", "Mushroom", "Algae", "Yeast", "Classification"],
];
const BASIC_SCIENCE: Fact[] = [
  ["Which part of a plant cell controls its activities?", "Nucleus", "Cell wall", "Vacuole", "Chloroplast", "Living things"],
  ["The SI unit of force is the", "newton", "joule", "watt", "pascal", "Force"],
  ["Which of these is a non-renewable source of energy?", "Crude oil", "Solar", "Wind", "Hydro", "Energy"],
  ["Pure water boils at sea level at", "$100^{\\circ}\\text{C}$", "$90^{\\circ}\\text{C}$", "$50^{\\circ}\\text{C}$", "$212^{\\circ}\\text{C}$", "States of matter"],
  ["Malaria is spread by the female", "Anopheles mosquito", "Culex mosquito", "tsetse fly", "housefly", "Health"],
  ["Which of these is a mixture?", "Salt solution", "Distilled water", "Oxygen", "Sodium", "Matter"],
  ["The planet closest to the sun is", "Mercury", "Venus", "Earth", "Mars", "Space"],
  ["Which is a good conductor of electricity?", "Copper", "Rubber", "Wood", "Plastic", "Electricity"],
  ["Ice melting is an example of a", "physical change", "chemical change", "nuclear change", "biological change", "Matter"],
  ["The organ that pumps blood round the body is the", "heart", "lungs", "liver", "kidney", "Human body"],
  ["Which nutrient gives the body energy fastest?", "Carbohydrate", "Protein", "Water", "Vitamin", "Nutrition"],
  ["A device that changes chemical energy to electrical energy is a", "battery", "bulb", "fan", "switch", "Energy"],
  ["Which of these is a living thing?", "Mushroom", "Stone", "Water", "Air", "Living things"],
  ["The force that pulls objects towards the earth is", "gravity", "friction", "magnetism", "tension", "Force"],
  ["Sound travels fastest through", "solids", "liquids", "gases", "a vacuum", "Waves"],
  ["Which gas do we breathe out more of than we breathe in?", "Carbon(IV) oxide", "Oxygen", "Nitrogen", "Hydrogen", "Human body"],
  ["The main gas in air is", "nitrogen", "oxygen", "carbon(IV) oxide", "argon", "Matter"],
  ["Which of these is a disease caused by a virus?", "Measles", "Malaria", "Typhoid", "Cholera", "Health"],
  ["A magnet attracts", "iron", "copper", "aluminium", "wood", "Magnetism"],
  ["Rainbow colours are seen because light is", "dispersed", "reflected only", "absorbed", "magnetised", "Light"],
  ["The skeleton protects the", "internal organs", "skin", "hair", "nails", "Human body"],
  ["Which is the smallest particle of an element?", "Atom", "Molecule", "Compound", "Mixture", "Matter"],
  ["Plants take in water through their", "roots", "leaves", "flowers", "fruits", "Living things"],
  ["Which of these reduces friction?", "Oil", "Sand", "Rough surfaces", "Rubber soles", "Force"],
  ["Shadows are formed because light travels in", "straight lines", "curves", "circles", "zigzags", "Light"],
  ["The unit of electric current is the", "ampere", "volt", "ohm", "watt", "Electricity"],
  ["Which family planning topic is about spacing births?", "Child spacing", "Immunisation", "First aid", "Sanitation", "Family health"],
  ["A thermometer measures", "temperature", "mass", "time", "length", "Measurement"],
];
const BASIC_TECH: Fact[] = [
  ["Which tool is used for measuring straight lines on a drawing?", "Rule", "Compass", "Protractor", "Set square", "Drawing instruments"],
  ["A compass in technical drawing is used to draw", "circles and arcs", "straight lines", "angles", "letters", "Drawing instruments"],
  ["The material obtained from trees is", "wood", "metal", "plastic", "ceramic", "Materials"],
  ["Which is a ferrous metal?", "Iron", "Copper", "Aluminium", "Lead", "Materials"],
  ["A pencil marked 2H is", "hard", "soft", "medium", "coloured", "Drawing instruments"],
  ["Which safety item protects the eyes in the workshop?", "Goggles", "Apron", "Gloves", "Boots", "Safety"],
  ["Which tool is used to drive nails?", "Claw hammer", "Screwdriver", "Pliers", "Spanner", "Hand tools"],
  ["Isometric drawings are drawn at", "$30^{\\circ}$", "$45^{\\circ}$", "$60^{\\circ}$", "$90^{\\circ}$", "Drawing"],
  ["Which of these is a renewable building material?", "Timber", "Iron ore", "Crude oil", "Granite", "Materials"],
  ["Rust on steel can be prevented by", "painting", "heating", "wetting", "bending", "Materials"],
  ["The tool used to cut wood along the grain is the", "rip saw", "hacksaw", "tenon saw", "coping saw", "Hand tools"],
  ["A first-aid box should be kept", "where everyone can reach it", "locked away", "outside", "in the principal's office", "Safety"],
  ["Which of these is a thermoplastic?", "Polythene", "Bakelite", "Wood", "Glass", "Materials"],
  ["The drawing that shows the front, top and side of an object is", "orthographic projection", "freehand sketch", "perspective", "isometric", "Drawing"],
  ["Which energy source is used by a solar panel?", "Sunlight", "Wind", "Coal", "Water", "Energy"],
  ["The unit of electrical power is the", "watt", "ampere", "ohm", "volt", "Electricity"],
  ["Which tool tightens bolts?", "Spanner", "Hammer", "Chisel", "File", "Hand tools"],
  ["Ceramics are made mainly from", "clay", "iron", "wood", "rubber", "Materials"],
  ["A fuse in a circuit protects against", "too much current", "low voltage", "darkness", "heat loss", "Electricity"],
  ["The title block on a drawing shows", "the name and scale", "the colour", "the price", "the weather", "Drawing"],
];
const SOCIAL: Fact[] = [
  ["The smallest unit of society is the", "family", "community", "state", "school", "Family"],
  ["Nigeria gained independence in", "1960", "1963", "1914", "1999", "Nigeria"],
  ["Which of these is a cultural festival in Nigeria?", "Argungu fishing festival", "Christmas", "Valentine's Day", "Independence Day", "Culture"],
  ["Respect for elders is an example of a", "value", "law", "crime", "tax", "Values"],
  ["The process of learning the ways of a society is", "socialisation", "migration", "urbanisation", "taxation", "Socialisation"],
  ["Which of these is a means of transport?", "Railway", "Telephone", "Radio", "Newspaper", "Transport and communication"],
  ["Drug abuse means", "using drugs wrongly", "selling drugs", "making drugs", "keeping drugs", "Social problems"],
  ["The capital of Nigeria is", "Abuja", "Lagos", "Kano", "Ibadan", "Nigeria"],
  ["Marriage between one man and one woman is", "monogamy", "polygamy", "polyandry", "divorce", "Family"],
  ["People who move from villages to cities are taking part in", "rural–urban migration", "urban–rural migration", "emigration", "deportation", "Population"],
  ["Which agency fights drug trafficking in Nigeria?", "NDLEA", "FRSC", "NAFDAC", "INEC", "Social problems"],
  ["The road safety agency in Nigeria is the", "FRSC", "EFCC", "NDLEA", "NPC", "Institutions"],
  ["Which of these is a social institution?", "School", "River", "Market day", "Rain", "Institutions"],
  ["Cooperation means", "working together", "fighting", "competing alone", "stealing", "Values"],
  ["The number of states in Nigeria is", "36", "30", "19", "12", "Nigeria"],
  ["HIV is mainly spread through", "unprotected sexual contact", "handshakes", "mosquito bites", "sharing plates", "Health"],
  ["Which of these is a renewable resource?", "Forest", "Crude oil", "Coal", "Tin", "Resources"],
  ["The census counts a country's", "population", "money", "rivers", "roads", "Population"],
  ["Which of these is a traditional ruler's title among the Yoruba?", "Oba", "Emir", "Obi", "Senator", "Culture"],
  ["A person who cannot read or write is", "illiterate", "literate", "educated", "trained", "Social problems"],
  ["Good conduct expected in a society is", "norms", "taxes", "crimes", "debts", "Values"],
  ["Which of these is a cause of road accidents?", "Overspeeding", "Wearing seat belts", "Obeying signs", "Good roads", "Safety"],
  ["The River Niger and River Benue meet at", "Lokoja", "Onitsha", "Jebba", "Makurdi", "Nigeria"],
  ["Child labour means", "children doing harmful work", "children doing homework", "children playing", "children helping at home sometimes", "Social problems"],
  ["Which of these is a mass medium?", "Television", "Letter", "Diary", "Notebook", "Transport and communication"],
];
const CIVIC: Fact[] = [
  ["The highest law of Nigeria is the", "constitution", "bye-law", "decree", "customary law", "Constitution"],
  ["Citizens choose their leaders through", "elections", "coups", "inheritance", "appointments", "Democracy"],
  ["The body that conducts elections in Nigeria is", "INEC", "EFCC", "NDLEA", "FRSC", "Democracy"],
  ["Paying tax is a", "civic duty", "human right", "crime", "privilege", "Citizenship"],
  ["The right to life is a", "fundamental human right", "duty", "privilege", "law of nature only", "Human rights"],
  ["Which arm of government makes laws?", "Legislature", "Executive", "Judiciary", "Civil service", "Government"],
  ["Which arm of government interprets laws?", "Judiciary", "Legislature", "Executive", "Police", "Government"],
  ["The Nigerian national anthem begins with", "Arise, O compatriots", "Nigeria, we hail thee", "I pledge to Nigeria", "God bless Nigeria", "National symbols"],
  ["Corruption means", "dishonest use of power for gain", "hard work", "obeying laws", "honest trade", "Values"],
  ["The colours of the Nigerian flag are", "green, white, green", "green, white, red", "white, green, white", "green, yellow, green", "National symbols"],
  ["A person who is a legal member of a country is a", "citizen", "tourist", "visitor", "refugee", "Citizenship"],
  ["The rule of law means", "everyone is equal before the law", "the president is above the law", "only the rich obey laws", "laws are optional", "Rule of law"],
  ["Which of these is a human right?", "Freedom of expression", "Paying tax", "Voting twice", "Breaking the law", "Human rights"],
  ["The head of the executive arm in Nigeria is the", "President", "Senate President", "Chief Justice", "Speaker", "Government"],
  ["Which body fights financial crimes in Nigeria?", "EFCC", "INEC", "NDLEA", "NAFDAC", "Institutions"],
  ["Obeying traffic rules is part of", "responsible citizenship", "corruption", "cultism", "rioting", "Citizenship"],
  ["Cultism in schools is", "illegal and dangerous", "a club activity", "compulsory", "a sport", "Social problems"],
  ["Peaceful settlement of disputes is", "conflict resolution", "war", "revenge", "protest", "Peace"],
  ["The voting age in Nigeria is", "18", "16", "21", "25", "Democracy"],
  ["Which of these is a national symbol?", "Coat of arms", "Football", "Market", "Bus", "National symbols"],
  ["Federalism means power is shared between", "central and state governments", "the police and army", "families", "schools", "Government"],
  ["Honesty is a", "value", "law", "tax", "court", "Values"],
  ["The upper house of the National Assembly is the", "Senate", "House of Representatives", "Federal Executive Council", "Supreme Court", "Government"],
  ["Which of these violates human rights?", "Torture", "Fair hearing", "Education", "Free speech", "Human rights"],
  ["A person who refuses to take part in elections shows", "voter apathy", "patriotism", "loyalty", "integrity", "Democracy"],
];
const ECONOMICS: Fact[] = [
  ["Economics is the study of how people use", "scarce resources", "unlimited resources", "free goods only", "money only", "Basic concepts"],
  ["The alternative forgone when a choice is made is", "opportunity cost", "money cost", "real cost", "total cost", "Basic concepts"],
  ["A market where buyers and sellers meet online is", "an e-market", "a mall", "a village market", "a stock exchange only", "Markets"],
  ["When price rises, quantity demanded usually", "falls", "rises", "stays the same", "doubles", "Demand and supply"],
  ["Which is a factor of production?", "Land", "Money", "Profit", "Price", "Production"],
  ["The reward for labour is", "wages", "rent", "interest", "profit", "Production"],
  ["The reward for land is", "rent", "wages", "interest", "profit", "Production"],
  ["Inflation is a persistent rise in the", "general price level", "value of money", "level of employment", "rate of saving", "Money"],
  ["The Central Bank of Nigeria is the", "banker to the government", "a commercial bank", "a merchant bank", "a microfinance bank", "Banking"],
  ["A firm that is the only seller in a market is a", "monopoly", "perfect competitor", "oligopoly", "partnership", "Markets"],
  ["Which of these is a direct tax?", "Income tax", "VAT", "Import duty", "Excise duty", "Public finance"],
  ["GDP measures the value of", "goods and services produced in a country", "a country's money supply", "exports only", "imports only", "National income"],
  ["Division of labour leads to", "specialisation", "unemployment only", "lower output", "barter", "Production"],
  ["The exchange of goods for goods is", "barter", "trade by money", "credit", "auction", "Money"],
  ["A business owned by one person is a", "sole proprietorship", "partnership", "company", "cooperative", "Business units"],
];

function economicsCalc(): GenQ[] {
  const out: GenQ[] = [];
  const E = "Economics";
  repeat(10, () => {
    const [p, q] = [int(2, 20) * 50, int(5, 40)];
    return mk(E, pick(SS), "Demand and supply", "easy", `A trader sells ${q} bags at ${naira(p)} each. What is the total revenue?`, naira(p * q), [naira(p + q), naira(p), naira((p * q) / 2)]);
  }, out);
  repeat(8, () => {
    const [old, rise] = [int(4, 20) * 50, pick([10, 20, 25, 50])];
    return mk(E, pick(SS), "Money", "medium", `The price of a loaf rises from ${naira(old)} by ${rise}%. What is the new price?`, naira(old + (old * rise) / 100), [naira(old + rise), naira((old * rise) / 100), naira(old * rise)]);
  }, out);
  return out;
}

// ─── English ─────────────────────────────────────────────────────────────────

const SYNONYMS: [string, string, string, string, string][] = [
  ["candid", "honest", "brief", "angry", "confusing"],
  ["diligent", "hard-working", "clever", "careless", "quiet"],
  ["reluctant", "unwilling", "eager", "late", "afraid"],
  ["vast", "huge", "empty", "far", "dry"],
  ["timid", "shy", "bold", "tiny", "rude"],
  ["commence", "begin", "end", "continue", "delay"],
  ["obscure", "unclear", "famous", "bright", "simple"],
  ["prudent", "wise", "proud", "careless", "rich"],
  ["hostile", "unfriendly", "welcoming", "sick", "lonely"],
  ["abundant", "plentiful", "rare", "costly", "distant"],
  ["frail", "weak", "strong", "old", "thin"],
  ["vivid", "bright", "dull", "quick", "rare"],
  ["ponder", "think about", "forget", "shout", "hurry"],
  ["meagre", "small", "large", "generous", "fair"],
  ["rigid", "stiff", "soft", "loose", "bent"],
  ["jubilant", "joyful", "sad", "tired", "angry"],
  ["conceal", "hide", "show", "find", "carry"],
  ["fatigue", "tiredness", "energy", "hunger", "fear"],
  ["adequate", "enough", "lacking", "extra", "late"],
  ["notorious", "infamous", "famous", "unknown", "honest"],
];
const ANTONYMS: [string, string, string, string, string][] = [
  ["congested", "spacious", "crowded", "noisy", "decorated"],
  ["scarce", "plentiful", "rare", "expensive", "small"],
  ["ancient", "modern", "old", "broken", "famous"],
  ["generous", "mean", "kind", "rich", "open"],
  ["humble", "proud", "quiet", "poor", "simple"],
  ["victory", "defeat", "win", "battle", "prize"],
  ["expand", "contract", "grow", "spread", "build"],
  ["optimistic", "pessimistic", "hopeful", "cheerful", "careful"],
  ["permanent", "temporary", "lasting", "fixed", "solid"],
  ["guilty", "innocent", "ashamed", "wicked", "sorry"],
  ["shallow", "deep", "wide", "narrow", "low"],
  ["accept", "refuse", "receive", "agree", "allow"],
  ["artificial", "natural", "fake", "plastic", "made"],
  ["superior", "inferior", "better", "higher", "upper"],
  ["rigid", "flexible", "stiff", "hard", "firm"],
];
const CONCORD: [string, string, string, string, string][] = [
  ["Each of the boys ___ a bicycle.", "has", "have", "are having", "were having"],
  ["The news ___ very encouraging.", "is", "are", "were", "have been"],
  ["Neither the teacher nor the students ___ aware of the change.", "were", "was", "is", "has been"],
  ["One of the girls ___ lost her bag.", "has", "have", "are", "were"],
  ["Bread and butter ___ my favourite breakfast.", "is", "are", "were", "have been"],
  ["The committee ___ its report yesterday.", "submitted", "submit", "submits", "have submit"],
  ["Mathematics ___ my best subject.", "is", "are", "were", "have been"],
  ["Every student and teacher ___ present.", "was", "were", "are", "have been"],
  ["The number of absentees ___ increasing.", "is", "are", "were", "have been"],
  ["A pair of scissors ___ on the table.", "is", "are", "were", "have been"],
  ["Ten kilometres ___ a long way to walk.", "is", "are", "were", "have been"],
  ["Either Ada or her sisters ___ coming.", "are", "is", "was", "has been"],
];
const SPELLING: [string, string, string, string][] = [
  ["accommodation", "accomodation", "acommodation", "acomodation"],
  ["necessary", "neccessary", "necesary", "nessecary"],
  ["embarrass", "embarass", "embarras", "emberrass"],
  ["occurrence", "occurence", "ocurrence", "occurance"],
  ["separate", "seperate", "separete", "seperete"],
  ["committee", "commitee", "comittee", "committe"],
  ["definitely", "definately", "definitly", "defenitely"],
  ["government", "goverment", "governement", "govermant"],
  ["receive", "recieve", "receeve", "reseive"],
  ["environment", "enviroment", "envirnment", "environmant"],
  ["privilege", "priviledge", "privelege", "privilage"],
  ["maintenance", "maintainance", "maintenence", "maintanance"],
];

function english(): GenQ[] {
  const out: GenQ[] = [];
  const E = "English Language";
  const lv = (i: number) => [...JSS, ...SS][i % 6];
  SYNONYMS.forEach(([w, r, a, b, c], i) => {
    const q = mk(E, lv(i), "Vocabulary", i % 3 ? "easy" : "medium", `Choose the option nearest in meaning to the word in quotes: The report was “${w}”.`.replace("The report was", i % 2 ? "Her answer was" : "The report was"), r, [a, b, c]);
    if (q) out.push(q);
  });
  ANTONYMS.forEach(([w, r, a, b, c], i) => {
    const q = mk(E, lv(i + 2), "Vocabulary", "medium", `Choose the option opposite in meaning to the word in quotes: The hall was “${w}”.`, r, [a, b, c]);
    if (q) out.push(q);
  });
  CONCORD.forEach(([s, r, a, b, c], i) => {
    const q = mk(E, lv(i + 1), "Concord", "hard", `Choose the option that best completes the sentence: ${s}`, r, [a, b, c]);
    if (q) out.push(q);
  });
  SPELLING.forEach(([r, a, b, c], i) => {
    const q = mk(E, lv(i + 3), "Spelling", "medium", `Choose the correctly spelt word (${i + 1}).`, r, [a, b, c]);
    if (q) out.push(q);
  });
  return out;
}

export const PASSAGE = {
  title: "The School Garden",
  paras: [
    "When the rains came early that year, the JSS2 students of Crestview cleared the bush behind the laboratory and turned it into a garden. Each class took a bed. Some planted maize and okra; others chose pepper and ugu.",
    "For weeks nothing seemed to happen. Then the first shoots appeared, and the students who had grumbled about weeding began to visit the garden at break time. They learned to water in the evening, to keep goats out with a fence of palm fronds, and to share the work fairly.",
    "By the end of term the garden had fed the boarding house for a week. The principal said the lesson was not really about farming at all. It was about patience, and about what a group can do when everyone keeps a promise.",
  ],
  questions: [
    ["What did the students turn the bush into?", "A garden", "A football field", "A laboratory", "A boarding house", 0],
    ["Why did the students fence the garden with palm fronds?", "To keep goats out", "To shade the plants", "To mark each class's bed", "To stop students visiting", 0],
    ["When did the students learn to water the plants?", "In the evening", "At break time", "At midnight", "Only when it rained", 3],
    ["According to the principal, the garden was really a lesson about", "patience and keeping promises", "farming methods", "feeding the boarding house", "clearing bush", 2],
    ["The word “grumbled”, as used in the passage, means", "complained", "laughed", "worked hard", "sang", 2],
  ] as [string, string, string, string, string, number][],
};

export const THEORY: TheoryQ[] = [
  { subject: "Mathematics", level: "JSS3", topic: "Simultaneous equations", stem: "Solve the simultaneous equations $2x + y = 7$ and $x - y = 2$. Show all your working.", marks: 10, guide: "Adds the equations: $3x = 9$ (3). $x = 3$ (2). Substitutes: $y = 1$ (3). Checks in both equations (2)." },
  { subject: "Basic Science", level: "JSS3", topic: "Health", stem: "Explain three ways a school can reduce the spread of malaria among its students.", marks: 10, guide: "Any three, well explained (3 each, +1 clear writing): clear stagnant water and gutters; nets for boarders; cut grass; screen windows; spray insecticide; seek early treatment." },
  { subject: "Biology", level: "SS2", topic: "Nutrition", stem: "State the raw materials and products of photosynthesis and write the overall word equation.", marks: 8, guide: "Raw materials: carbon(IV) oxide and water (2). Products: glucose and oxygen (2). Needs light and chlorophyll (2). Equation correct (2)." },
  { subject: "Physics", level: "SS2", topic: "Motion", stem: "A car accelerates uniformly from rest to 20 m/s in 5 s. Calculate its acceleration and the distance covered.", marks: 8, guide: "$a = 20/5 = 4\\text{ m/s}^2$ (4). $s = \\frac{1}{2}at^2 = 50\\text{ m}$ (4)." },
  { subject: "English Language", level: "SS1", topic: "Essay", stem: "Write a short letter to your principal suggesting two ways to keep the school compound clean.", marks: 10, guide: "Format of a formal letter (3). Two clear, practical suggestions (4). Language and paragraphing (3)." },
  { subject: "Civic Education", level: "JSS2", topic: "Citizenship", stem: "List and explain three duties of a good citizen.", marks: 6, guide: "Any three with explanation (2 each): obey laws; pay taxes; vote; respect national symbols; protect public property." },
];

/** Every generated objective question, ~600. */
export function demoQuestions(): GenQ[] {
  return [
    ...maths(),
    ...physics(),
    ...chemistry(),
    ...economicsCalc(),
    ...facts("Biology", SS, BIOLOGY),
    ...facts("Basic Science", JSS, BASIC_SCIENCE),
    ...facts("Basic Technology", JSS, BASIC_TECH),
    ...facts("Social Studies", JSS, SOCIAL),
    ...facts("Civic Education", [...JSS, ...SS], CIVIC),
    ...facts("Economics", SS, ECONOMICS),
    ...english(),
  ];
}
