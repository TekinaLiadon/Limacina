package utils

import (
	"os"
)

func DeleteDir(path string) error {
	err := os.RemoveAll(path)
	if err != nil {
		return CreateError(1003, err)
	}
	return nil
}
