import type { User } from "@isomorphiq/auth/types";
interface LoginFormProps {
    onSuccess?: (user: User, token: string) => void;
    onError?: (error: string) => void;
}
export declare function LoginForm({ onSuccess, onError }: LoginFormProps): import("react/jsx-runtime").JSX.Element;
export {};
