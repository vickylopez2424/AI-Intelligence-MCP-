import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_STRING_LENGTH } from "../utils/validation.js";

// ASCII art character maps
const ASCII_FONTS: Record<string, Record<string, string[]>> = {
  block: {
    A: ["  █  ", " █ █ ", "█████", "█   █", "█   █"],
    B: ["████ ", "█   █", "████ ", "█   █", "████ "],
    C: [" ████", "█    ", "█    ", "█    ", " ████"],
    D: ["████ ", "█   █", "█   █", "█   █", "████ "],
    E: ["█████", "█    ", "████ ", "█    ", "█████"],
    F: ["█████", "█    ", "████ ", "█    ", "█    "],
    G: [" ████", "█    ", "█  ██", "█   █", " ████"],
    H: ["█   █", "█   █", "█████", "█   █", "█   █"],
    I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
    J: ["█████", "    █", "    █", "█   █", " ███ "],
    K: ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
    L: ["█    ", "█    ", "█    ", "█    ", "█████"],
    M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
    N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
    O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
    P: ["████ ", "█   █", "████ ", "█    ", "█    "],
    Q: [" ███ ", "█   █", "█ █ █", "█  █ ", " ██ █"],
    R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
    S: [" ████", "█    ", " ███ ", "    █", "████ "],
    T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
    U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
    V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
    W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
    X: ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
    Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
    Z: ["█████", "   █ ", "  █  ", " █   ", "█████"],
    " ": ["     ", "     ", "     ", "     ", "     "],
    "0": [" ███ ", "█  ██", "█ █ █", "██  █", " ███ "],
    "1": ["  █  ", " ██  ", "  █  ", "  █  ", "█████"],
    "2": [" ███ ", "█   █", "  ██ ", " █   ", "█████"],
    "3": ["████ ", "    █", " ███ ", "    █", "████ "],
    "4": ["█   █", "█   █", "█████", "    █", "    █"],
    "5": ["█████", "█    ", "████ ", "    █", "████ "],
    "6": [" ███ ", "█    ", "████ ", "█   █", " ███ "],
    "7": ["█████", "   █ ", "  █  ", " █   ", "█    "],
    "8": [" ███ ", "█   █", " ███ ", "█   █", " ███ "],
    "9": [" ███ ", "█   █", " ████", "    █", " ███ "],
    "!": ["  █  ", "  █  ", "  █  ", "     ", "  █  "],
    "?": [" ███ ", "█   █", "  ██ ", "     ", "  █  "],
    ".": ["     ", "     ", "     ", "     ", "  █  "],
    "-": ["     ", "     ", "█████", "     ", "     "],
  },
};

// Color theory utilities
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 0, g: 0, b: 0 };
}

// Theme-based color palettes
const THEME_PALETTES: Record<string, { hues: number[]; saturation: number; lightness: number[] }> = {
  ocean: { hues: [200, 210, 220, 190, 180], saturation: 70, lightness: [30, 40, 50, 60, 70] },
  sunset: { hues: [0, 15, 30, 45, 350], saturation: 80, lightness: [40, 50, 55, 60, 45] },
  forest: { hues: [120, 140, 100, 80, 150], saturation: 50, lightness: [25, 35, 40, 45, 30] },
  pastel: { hues: [0, 60, 120, 200, 280], saturation: 50, lightness: [80, 82, 78, 80, 82] },
  neon: { hues: [300, 180, 60, 120, 330], saturation: 100, lightness: [50, 50, 50, 50, 50] },
  earth: { hues: [25, 35, 45, 15, 30], saturation: 40, lightness: [30, 40, 50, 35, 45] },
  monochrome: { hues: [0, 0, 0, 0, 0], saturation: 0, lightness: [15, 30, 50, 70, 85] },
  candy: { hues: [330, 290, 200, 160, 30], saturation: 75, lightness: [65, 60, 65, 60, 70] },
};

export function registerCreativeTools(server: McpServer) {
  // --- ascii_art ---
  server.tool(
    "ascii_art",
    "Convert text to ASCII block art.",
    {
      text: z.string().max(50).describe("Text to convert (max 50 characters)"),
    },
    async ({ text }) => {
      const upper = text.toUpperCase();
      const font = ASCII_FONTS.block;
      const lines: string[] = ["", "", "", "", ""];

      for (const char of upper) {
        const glyph = font[char];
        if (glyph) {
          for (let row = 0; row < 5; row++) {
            lines[row] += glyph[row] + " ";
          }
        } else {
          for (let row = 0; row < 5; row++) {
            lines[row] += "     " + " ";
          }
        }
      }

      const art = lines.map((l) => l.trimEnd()).join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `\`\`\`\n${art}\n\`\`\``,
          },
        ],
      };
    }
  );

  // --- color_palette ---
  server.tool(
    "color_palette",
    "Generate a color palette from a theme or base color.",
    {
      theme: z
        .enum(["ocean", "sunset", "forest", "pastel", "neon", "earth", "monochrome", "candy", "custom"])
        .describe("Color theme"),
      baseColor: z
        .string()
        .max(7)
        .optional()
        .describe("Base hex color for 'custom' theme (e.g. '#FF5733'). Generates complementary, analogous, triadic, and split-complementary."),
      count: z.number().int().min(3).max(10).default(5).describe("Number of colors"),
    },
    async ({ theme, baseColor, count }) => {
      let colors: string[] = [];

      if (theme === "custom" && baseColor) {
        // Generate palette from base color using color theory
        const rgb = hexToRgb(baseColor);
        // Approximate hue from RGB
        const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0;
        const l = ((max + min) / 2) * 100;
        const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * (max + min) / 2 - 1)) * 100;

        if (max !== min) {
          const d = max - min;
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
          else if (max === g) h = ((b - r) / d + 2) * 60;
          else h = ((r - g) / d + 4) * 60;
        }

        // Generate harmonious colors
        const offsets = [0, 30, 60, 180, 210, 270, 315, 150, 120, 330];
        for (let i = 0; i < count; i++) {
          colors.push(hslToHex((h + offsets[i % offsets.length]) % 360, Math.min(s, 100), Math.min(l, 85)));
        }
      } else {
        const palette = THEME_PALETTES[theme] || THEME_PALETTES.ocean;
        for (let i = 0; i < count; i++) {
          const hue = palette.hues[i % palette.hues.length];
          const lightness = palette.lightness[i % palette.lightness.length];
          colors.push(hslToHex(hue, palette.saturation, lightness));
        }
      }

      const swatches = colors
        .map((c, i) => {
          const rgb = hexToRgb(c);
          return `| ${i + 1} | \`${c}\` | rgb(${rgb.r}, ${rgb.g}, ${rgb.b}) |`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `## Color Palette — ${theme}${baseColor ? ` (base: ${baseColor})` : ""}\n\n| # | Hex | RGB |\n|---|-----|-----|\n${swatches}\n\n**CSS variables:**\n\`\`\`css\n:root {\n${colors.map((c, i) => `  --color-${i + 1}: ${c};`).join("\n")}\n}\n\`\`\``,
          },
        ],
      };
    }
  );

  // --- image_prompt ---
  server.tool(
    "image_prompt",
    "Build a detailed, structured prompt for AI image generation (DALL-E, Midjourney, Stable Diffusion).",
    {
      subject: z.string().max(200).describe("Main subject of the image"),
      style: z
        .enum([
          "photorealistic",
          "digital-art",
          "oil-painting",
          "watercolor",
          "anime",
          "pixel-art",
          "3d-render",
          "pencil-sketch",
          "comic-book",
          "minimalist",
        ])
        .describe("Art style"),
      mood: z
        .enum(["dramatic", "peaceful", "energetic", "mysterious", "whimsical", "dark", "warm", "cold", "nostalgic", "futuristic"])
        .describe("Mood/atmosphere"),
      lighting: z
        .enum(["golden-hour", "studio", "neon", "moonlight", "overcast", "backlit", "dramatic-shadows", "soft-diffused"])
        .default("golden-hour")
        .describe("Lighting style"),
      camera: z
        .enum(["wide-angle", "close-up", "aerial", "eye-level", "low-angle", "macro", "portrait", "panoramic"])
        .default("eye-level")
        .describe("Camera angle/perspective"),
      details: z.string().max(500).optional().describe("Additional details or elements to include"),
    },
    async ({ subject, style, mood, lighting, camera, details }) => {
      const styleDescriptors: Record<string, string> = {
        "photorealistic": "ultra-realistic photograph, 8K resolution, sharp focus, photojournalistic",
        "digital-art": "digital illustration, vibrant colors, detailed rendering, trending on ArtStation",
        "oil-painting": "oil painting on canvas, visible brushstrokes, rich textures, classical technique",
        "watercolor": "delicate watercolor painting, soft washes, gentle bleeding edges, paper texture",
        "anime": "anime style, cel-shaded, expressive eyes, vibrant, Studio Ghibli inspired",
        "pixel-art": "pixel art, 16-bit style, limited color palette, retro gaming aesthetic",
        "3d-render": "3D render, Octane render, subsurface scattering, volumetric lighting, Unreal Engine 5",
        "pencil-sketch": "detailed pencil sketch, cross-hatching, graphite on paper, hand-drawn",
        "comic-book": "comic book style, bold outlines, halftone dots, dynamic composition, Marvel/DC aesthetic",
        "minimalist": "minimalist design, clean lines, negative space, limited color palette, geometric",
      };

      const moodDescriptors: Record<string, string> = {
        dramatic: "intense atmosphere, high contrast, powerful emotions",
        peaceful: "serene, tranquil, calming atmosphere, harmony",
        energetic: "dynamic, motion blur, explosive energy, vibrant",
        mysterious: "enigmatic, misty, hidden details, intrigue",
        whimsical: "playful, fantastical, dreamlike, magical realism",
        dark: "moody, somber, deep shadows, brooding",
        warm: "cozy, inviting, amber tones, comfortable",
        cold: "icy, blue tones, stark, crisp atmosphere",
        nostalgic: "vintage feel, muted colors, memory-like, timeless",
        futuristic: "sci-fi, holographic, chrome, advanced technology",
      };

      const lightingDescriptors: Record<string, string> = {
        "golden-hour": "golden hour sunlight, warm orange glow, long shadows",
        "studio": "professional studio lighting, even illumination, catchlights",
        "neon": "neon lights, cyberpunk glow, colorful reflections",
        "moonlight": "soft moonlight, blue-silver tones, nighttime ambiance",
        "overcast": "diffused overcast light, soft shadows, even tones",
        "backlit": "strong backlighting, silhouette edges, rim light, lens flare",
        "dramatic-shadows": "chiaroscuro, strong directional light, deep shadows",
        "soft-diffused": "soft diffused lighting, gentle gradients, no harsh shadows",
      };

      const prompt = [
        subject,
        styleDescriptors[style],
        moodDescriptors[mood],
        lightingDescriptors[lighting],
        `${camera} perspective`,
        details,
        "masterpiece, best quality, highly detailed",
      ]
        .filter(Boolean)
        .join(", ");

      const negativePrompt =
        "blurry, low quality, distorted, deformed, ugly, duplicate, watermark, text, signature";

      return {
        content: [
          {
            type: "text" as const,
            text: `## Image Prompt\n\n**Prompt:**\n\`\`\`\n${prompt}\n\`\`\`\n\n**Negative Prompt:**\n\`\`\`\n${negativePrompt}\n\`\`\`\n\n**Settings:**\n| Parameter | Value |\n|-----------|-------|\n| Style | ${style} |\n| Mood | ${mood} |\n| Lighting | ${lighting} |\n| Camera | ${camera} |`,
          },
        ],
      };
    }
  );
}
