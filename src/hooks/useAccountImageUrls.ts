import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalApiError } from "../api/localApiClient";
import type { Account } from "../db";
import { getRepositoryBackend } from "../repositories/adapterSelection";
import { getSelectedReadRepositories } from "../repositories/selectedReadRepositories";

interface AccountImageUrlState {
  imageUrls: Map<number, string>;
  errorCodes: Map<number, string>;
}

interface AccountImageUrlResult extends AccountImageUrlState {
  invalidate: () => void;
}

const safeImageErrorCode = (error: unknown): string => {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as LocalApiError).code === "string"
  ) {
    return (error as LocalApiError).code;
  }
  return "account_image_load_failed";
};

export const useAccountImageUrls = (
  accounts: Array<Pick<Account, "id">>,
): AccountImageUrlResult => {
  const accountIds = useMemo(
    () =>
      accounts
        .map((account) => account.id)
        .filter((id): id is number => typeof id === "number"),
    [accounts],
  );
  const accountIdsKey = accountIds.join(",");
  const [state, setState] = useState<AccountImageUrlState>({
    imageUrls: new Map(),
    errorCodes: new Map(),
  });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const activeObjectUrlsRef = useRef(new Set<string>());
  const revokeActiveObjectUrls = useCallback(() => {
    activeObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    activeObjectUrlsRef.current.clear();
  }, []);
  const invalidate = useCallback(() => {
    revokeActiveObjectUrls();
    setState({ imageUrls: new Map(), errorCodes: new Map() });
    setRefreshVersion((version) => version + 1);
  }, [revokeActiveObjectUrls]);

  useEffect(() => {
    let active = true;
    const objectUrls = new Set<string>();
    const repositories = getSelectedReadRepositories(getRepositoryBackend());

    void Promise.all(
      accountIds.map(async (id) => {
        try {
          const image = await repositories.accounts.getImage(id);
          if (!image) return { id, status: "missing" as const };
          const url = URL.createObjectURL(image);
          objectUrls.add(url);
          return { id, status: "loaded" as const, url };
        } catch (error) {
          return {
            id,
            status: "error" as const,
            code: safeImageErrorCode(error),
          };
        }
      }),
    ).then((results) => {
      if (!active) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      revokeActiveObjectUrls();
      objectUrls.forEach((url) => activeObjectUrlsRef.current.add(url));
      const imageUrls = new Map<number, string>();
      const errorCodes = new Map<number, string>();
      for (const result of results) {
        if (result.status === "loaded") imageUrls.set(result.id, result.url);
        if (result.status === "error") errorCodes.set(result.id, result.code);
      }
      setState({ imageUrls, errorCodes });
    });

    return () => {
      active = false;
      objectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
        activeObjectUrlsRef.current.delete(url);
      });
    };
  }, [accountIdsKey, refreshVersion, revokeActiveObjectUrls]);

  useEffect(() => () => revokeActiveObjectUrls(), [revokeActiveObjectUrls]);

  return { ...state, invalidate };
};
