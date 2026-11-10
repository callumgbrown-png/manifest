export interface FeatureField {
  key: string;
  label: string;
  min?: number;
  max?: number;
  value?: number | string;
  options?: { value: number | string; label: string }[];
}

export interface FeatureAction {
  label: string;
  command: Record<string, unknown>;
  fields?: FeatureField[];
}

export interface FeatureCard {
  title: string;
  detail: string;
  actions?: FeatureAction[];
}
