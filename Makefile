.PHONY: all build debug clean install

BUILD_DIR := build

all: build

build:
	@mkdir -p $(BUILD_DIR)
	@cd $(BUILD_DIR) && cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
	@cd $(BUILD_DIR) && make -j$$(nproc)
	@echo "built: $(BUILD_DIR)/aniterm"

debug:
	@mkdir -p $(BUILD_DIR)
	@cd $(BUILD_DIR) && cmake .. -DCMAKE_BUILD_TYPE=Debug
	@cd $(BUILD_DIR) && make -j$$(nproc)

install: build
	@cd $(BUILD_DIR) && sudo make install

clean:
	@rm -rf $(BUILD_DIR)
