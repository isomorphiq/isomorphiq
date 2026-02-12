{
    description = "Example consumer of the isomorphiq k3s manifests flake";

    inputs.isomorphiq.url = "path:.";
    inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";

    outputs = { self, nixpkgs, isomorphiq }:
      let
        system = "x86_64-linux";
        pkgs = import nixpkgs { inherit system; };
      in {
        # Example command: nix run .#apply
        apps.${system}.apply = {
            type = "app";
            program = "${pkgs.kubectl}/bin/kubectl apply -f ${isomorphiq.packages.${system}.manifests}";
        };

        # Expose the manifest for other flakes to import or copy.
        packages.${system}.manifest = isomorphiq.packages.${system}.manifests;
      };
}
