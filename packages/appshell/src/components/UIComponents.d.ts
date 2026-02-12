import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
type CardProps = {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
};
export declare function Card({ children, className, style }: CardProps): import("react/jsx-runtime").JSX.Element;
export declare function CardHeader({ children, className, style }: CardProps): import("react/jsx-runtime").JSX.Element;
export declare function CardContent({ children, className, style }: CardProps): import("react/jsx-runtime").JSX.Element;
export declare function CardTitle({ children, className, style }: CardProps): import("react/jsx-runtime").JSX.Element;
interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}
interface State {
    hasError: boolean;
    error?: Error;
    errorInfo?: ErrorInfo;
}
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export declare class EnhancedErrorBoundary extends Component<Props, State> {
    constructor(props: Props);
    static getDerivedStateFromError(error: Error): State;
    componentDidCatch(error: Error, errorInfo: ErrorInfo): void;
    handleReset: () => void;
    render(): string | number | bigint | boolean | import("react/jsx-runtime").JSX.Element | Iterable<ReactNode> | Promise<string | number | bigint | boolean | import("react").ReactPortal | import("react").ReactElement<unknown, string | import("react").JSXElementConstructor<any>> | Iterable<ReactNode>>;
}
interface LoadingSpinnerProps {
    size?: "small" | "medium" | "large";
    message?: string;
    overlay?: boolean;
}
export declare function LoadingSpinner({ size, message, overlay, }: LoadingSpinnerProps): import("react/jsx-runtime").JSX.Element;
interface LoadingSkeletonProps {
    width?: string | number;
    height?: string | number;
    lines?: number;
    variant?: "text" | "rectangular" | "circular";
}
export declare function LoadingSkeleton({ width, height, lines, variant, }: LoadingSkeletonProps): import("react/jsx-runtime").JSX.Element;
interface EmptyStateProps {
    icon?: string;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}
export declare function EmptyState({ icon, title, description, action }: EmptyStateProps): import("react/jsx-runtime").JSX.Element;
interface RetryProps {
    error?: string;
    onRetry: () => void;
    retryCount?: number;
}
export declare function Retry({ error, onRetry, retryCount }: RetryProps): import("react/jsx-runtime").JSX.Element;
export {};
