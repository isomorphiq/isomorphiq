import type { ReactNode } from "react";
type LayoutProps = {
    children: ReactNode;
    showNav?: boolean;
    showFooter?: boolean;
};
export declare function Layout({ children, showNav, showFooter }: LayoutProps): import("react/jsx-runtime").JSX.Element;
export declare function Header({ title, subtitle, showAuthControls, user, onLogout, }: {
    title: string;
    subtitle?: string;
    user?: {
        username?: string;
        email?: string;
    };
    onLogout?: () => void;
    showAuthControls?: boolean;
}): import("react/jsx-runtime").JSX.Element;
export {};
