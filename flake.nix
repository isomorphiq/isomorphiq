{
    description = "Isomorphiq k3s manifests with Traefik ingress (generated as YAML)";

    inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";

    outputs = { self, nixpkgs }:
        let
            systems = [ "x86_64-linux" "aarch64-linux" ];
            forAllSystems = nixpkgs.lib.genAttrs systems;
            mkManifest = pkgs:
                pkgs.writeText "isomorphiq-k8s.yaml" ''
            apiVersion: v1
            kind: Namespace
            metadata:
              name: isomorphiq
            ---
            apiVersion: v1
            kind: ConfigMap
            metadata:
              name: isomorphiq-env
              namespace: isomorphiq
            data:
              HTTP_PORT: "3003"
              TCP_PORT: "3001"
            ---
            apiVersion: apps/v1
            kind: Deployment
            metadata:
              name: gateway
              namespace: isomorphiq
            spec:
              replicas: 1
              selector:
                matchLabels:
                  app: gateway
              template:
                metadata:
                  labels:
                    app: gateway
                spec:
                  containers:
                    - name: gateway
                      image: ghcr.io/isomorphiq/runtime:latest
                      imagePullPolicy: IfNotPresent
                      command: [ "node", "services/gateway/dist/index.js" ]
                      envFrom:
                        - configMapRef:
                            name: isomorphiq-env
                      ports:
                        - containerPort: 3003
                      readinessProbe:
                        httpGet:
                          path: /health
                          port: 3003
                      livenessProbe:
                        httpGet:
                          path: /health
                          port: 3003
            ---
            apiVersion: v1
            kind: Service
            metadata:
              name: gateway
              namespace: isomorphiq
            spec:
              selector:
                app: gateway
              ports:
                - name: http
                  port: 80
                  targetPort: 3003
            ---
            apiVersion: networking.k8s.io/v1
            kind: Ingress
            metadata:
              name: gateway
              namespace: isomorphiq
              annotations:
                kubernetes.io/ingress.class: traefik
                traefik.ingress.kubernetes.io/router.entrypoints: web
                traefik.ingress.kubernetes.io/router.tls: "false"
            spec:
              rules:
                - host: isomorphiq.localdev.me
                  http:
                    paths:
                      - path: /
                        pathType: Prefix
                        backend:
                          service:
                            name: gateway
                            port:
                              number: 80
            ---
            apiVersion: apps/v1
            kind: Deployment
            metadata:
              name: daemon
              namespace: isomorphiq
            spec:
              replicas: 1
              selector:
                matchLabels:
                  app: daemon
              template:
                metadata:
                  labels:
                    app: daemon
                spec:
                  containers:
                    - name: daemon
                      image: ghcr.io/isomorphiq/runtime:latest
                      imagePullPolicy: IfNotPresent
                      command: [ "node", "packages/worker/dist/index.js" ]
                      envFrom:
                        - configMapRef:
                            name: isomorphiq-env
                      ports:
                        - containerPort: 3001
            ---
            apiVersion: v1
            kind: Service
            metadata:
              name: daemon
              namespace: isomorphiq
            spec:
              selector:
                app: daemon
              ports:
                - name: tcp
                  port: 3001
                  targetPort: 3001
            ---
            apiVersion: apps/v1
            kind: Deployment
            metadata:
              name: workflows
              namespace: isomorphiq
            spec:
              replicas: 1
              selector:
                matchLabels:
                  app: workflows
              template:
                metadata:
                  labels:
                    app: workflows
                spec:
                  containers:
                    - name: workflows
                      image: ghcr.io/isomorphiq/runtime:latest
                      imagePullPolicy: IfNotPresent
                      command: [ "node", "services/workflows/dist/index.js" ]
                      envFrom:
                        - configMapRef:
                            name: isomorphiq-env
          '';
        in
        {
            packages = forAllSystems (system:
                let
                    pkgs = import nixpkgs { inherit system; };
                    manifest = mkManifest pkgs;
                in
                {
                    manifests = manifest;
                    default = manifest;
                });

            apps = forAllSystems (system:
                let
                    pkgs = import nixpkgs { inherit system; };
                    manifest = mkManifest pkgs;
                    kubectlApply = pkgs.writeShellScript "kubectl-apply" ''
                        exec ${pkgs.kubectl}/bin/kubectl apply -f ${manifest} "$@"
                    '';
                in
                {
                    kubectl-apply = {
                        type = "app";
                        program = kubectlApply;
                    };
                });

            devShells = forAllSystems (system:
                let
                    pkgs = import nixpkgs { inherit system; };
                in
                {
                    default = pkgs.mkShell {
                        packages = [
                            pkgs.kubectl
                            pkgs.python312
                            pkgs.uv
                            pkgs.stdenv.cc.cc.lib
                        ];
                        shellHook = ''
                            cpp_lib_path="${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ]}"
                            nvidia_driver_paths="/run/opengl-driver/lib:/run/opengl-driver/lib64:/usr/lib/wsl/lib"
                            export LD_LIBRARY_PATH="''${cpp_lib_path}:''${nvidia_driver_paths}:''${LD_LIBRARY_PATH:-}"
                            for cuda_dir in /run/opengl-driver/lib /run/opengl-driver/lib64 /usr/lib/wsl/lib; do
                                if [ -f "''${cuda_dir}/libcuda.so.1" ]; then
                                    export TRITON_LIBCUDA_PATH="''${cuda_dir}"
                                    break
                                fi
                            done

                            if [ ! -d ".venv" ]; then
                                echo "[nix develop] Creating Python virtualenv at .venv"
                                uv venv .venv --python ${pkgs.python312}/bin/python3.12
                            fi
                            if [ -f ".venv/bin/activate" ]; then
                                . .venv/bin/activate
                                echo "[nix develop] Activated virtualenv: $VIRTUAL_ENV"
                            fi
                        '';
                    };
                });
        };
}
