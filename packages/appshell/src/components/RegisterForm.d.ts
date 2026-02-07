import type { User } from "@isomorphiq/auth/types";
interface RegisterFormProps {
    onSuccess?: (user: User) => void;
    onError?: (error: string) => void;
}
export declare function RegisterForm({ onSuccess, onError }: RegisterFormProps): import("react/jsx-runtime").JSX.Element;
export {};
