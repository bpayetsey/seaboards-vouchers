/**
 * Corporate Lunch Buffet — client-facing menu content and rules.
 *
 * Shared by the public `/corporate-lunch` builder page and the api-server,
 * which validates selections against these ids. Ingredient costs are NOT here:
 * they live server-side (`api-server/src/lib/corporateLunch.ts`) so they never
 * ship in the browser bundle.
 */

export type CorporateLunchCourseId = "starters" | "mains" | "rice" | "desserts";

export interface CorporateLunchDish {
  /** Stable id stored on requests. Never rename once live. */
  id: string;
  name: string;
  description: string;
  /** Premium mains carry a higher extra-dish price. */
  premium?: boolean;
}

export interface CorporateLunchCourse {
  id: CorporateLunchCourseId;
  name: string;
  /** Dishes included in the set menu for this course. */
  included: number;
  /** Fewest dishes a client may choose in this course. */
  min: number;
  /** Price per person (SCR) for each dish beyond `included`. */
  extraPrice: number;
  /** Price per person (SCR) for each premium dish beyond `included`. */
  extraPremiumPrice?: number;
  dishes: CorporateLunchDish[];
}

export const CORPORATE_LUNCH = {
  title: "Corporate Lunch Buffet",
  service: "Buffet lunch, 11:00–14:30",
  minGuests: 10,
  maxGuests: 20,
  currency: "SCR",
  inclusions: [
    "Buffet set-up and service",
    "1 glass of house wine per guest",
  ],
  intro:
    "Your set menu includes 2 starters, 3 mains, rice and a dessert. Add as many extra dishes as you like — each one shows its price per person. When you’re happy, send us your request and we’ll confirm availability.",
} as const;

export const CORPORATE_LUNCH_COURSES: CorporateLunchCourse[] = [
  {
    id: "starters",
    name: "Starters",
    included: 2,
    min: 1,
    extraPrice: 50,
    dishes: [
      { id: "green-salad", name: "Green Salad", description: "Lettuce, tomato, cucumber, carrot, vinaigrette" },
      { id: "grilled-vegetables", name: "Grilled Mixed Vegetables", description: "Zucchini, eggplant, peppers, herbs" },
      { id: "soup", name: "Soup of the Day", description: "Vegetable, pumpkin or lentil" },
      { id: "smoked-fish-salad", name: "Smoked Fish Salad", description: "Smoked marlin, cucumber, lime" },
      { id: "seafood-salad", name: "Seafood Salad", description: "Seafood mix, peppers, lemon, herbs" },
    ],
  },
  {
    id: "mains",
    name: "Mains",
    included: 3,
    min: 2,
    extraPrice: 75,
    extraPremiumPrice: 125,
    dishes: [
      { id: "mixed-grill", name: "Mixed Grill", description: "Chicken wings & drumsticks, pork, chicken sausage" },
      { id: "beef-stir-fry", name: "Beef Stir Fry", description: "Beef, peppers, carrot, oyster sauce", premium: true },
      { id: "chicken-curry", name: "Chicken Curry", description: "Creole chicken curry with coconut milk" },
      { id: "lamb-curry", name: "Lamb Curry", description: "Slow-cooked lamb, potato, coconut milk", premium: true },
      { id: "chow-mein", name: "Chow Mein", description: "Egg noodles, chicken, vegetables" },
      { id: "grilled-fish", name: "Grilled Fish", description: "Job fish with Creole sauce" },
      { id: "garlic-prawns", name: "Garlic Prawns", description: "Prawns in garlic butter" },
      { id: "pasta-carbonara", name: "Pasta Carbonara", description: "Bacon, cream, parmesan" },
      { id: "honey-glazed-pork", name: "Honey Glazed Pork", description: "Pork belly, honey, soy, ginger" },
      { id: "pasta-ravioli", name: "Pasta Ravioli", description: "Ravioli with tomato and pesto", premium: true },
      { id: "roast-beef", name: "Roast Beef", description: "With gravy", premium: true },
      { id: "chicken-mushroom", name: "Chicken in Mushroom Sauce", description: "Chicken breast, mushroom cream sauce" },
      { id: "octopus-curry", name: "Octopus Curry", description: "Octopus in coconut curry", premium: true },
    ],
  },
  {
    id: "rice",
    name: "Rice",
    included: 1,
    min: 1,
    extraPrice: 25,
    dishes: [
      { id: "white-rice", name: "Steamed White Rice", description: "Basmati" },
      { id: "yellow-rice", name: "Yellow Rice", description: "Basmati with turmeric and spices" },
    ],
  },
  {
    id: "desserts",
    name: "Desserts",
    included: 1,
    min: 1,
    extraPrice: 50,
    dishes: [
      { id: "ice-cream", name: "Ice Cream", description: "Chocolate, strawberry, vanilla" },
      { id: "banana-caramel", name: "Banana Caramel", description: "Caramelised banana, cream" },
      { id: "cheesecake", name: "Cheesecake", description: "Baked vanilla cheesecake" },
    ],
  },
];

/** Pre-selected starting menu shown when the builder opens. */
export const CORPORATE_LUNCH_DEFAULT_SELECTION: Record<CorporateLunchCourseId, string[]> = {
  starters: ["green-salad", "soup"],
  mains: ["chicken-curry", "grilled-fish", "beef-stir-fry"],
  rice: ["white-rice"],
  desserts: ["ice-cream"],
};

/** Look up a dish by id across every course. */
export function findCorporateLunchDish(
  id: string,
): { course: CorporateLunchCourse; dish: CorporateLunchDish } | null {
  for (const course of CORPORATE_LUNCH_COURSES) {
    const dish = course.dishes.find((d) => d.id === id);
    if (dish) return { course, dish };
  }
  return null;
}
